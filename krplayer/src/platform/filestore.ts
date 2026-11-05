// The saved-file store behind Storage: one partition per project (cfg_db_relay.slug), held in memory
// so reads/writes stay synchronous, and written through to a Backend (IndexedDB in browsers).
// Quotas: PROJECT_QUOTA per project (writes past it are refused), TOTAL_QUOTA across all projects
// (the oldest files of other projects are evicted to make room).

import type { Storage } from './types.ts';

export const PROJECT_QUOTA = 500 * 1024;
export const TOTAL_QUOTA = 50 * 1024 * 1024;
export const UNPUBLISHED = '_unpublished';

export interface FileMeta { project: string; path: string; size: number; mtime: number }

export interface Backend {
  /** Metadata of every stored file, all projects. */
  loadMeta(): Promise<FileMeta[]>;
  loadFiles(project: string): Promise<Map<string, string>>;
  /** Deletes `del` then stores `put` (if any), in order relative to earlier commits. */
  commit(del: FileMeta[], put: { meta: FileMeta; data: string } | null): void;
}

/** UTF-8 byte length without allocating. */
function utf8Len(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

export class FileStore implements Storage {
  private project = UNPUBLISHED;
  private files = new Map<string, string>();
  /** Every file's metadata, keyed "project\0path". */
  private meta = new Map<string, FileMeta>();
  private total = 0;
  private used = 0;
  private readonly backend: Backend;
  private readonly warn: (msg: string) => void;
  constructor(backend: Backend, warn: (msg: string) => void = console.warn) { this.backend = backend; this.warn = warn; }

  async open(project: string): Promise<void> {
    this.project = project || UNPUBLISHED;
    try {
      const [meta, files] = await Promise.all([this.backend.loadMeta(), this.backend.loadFiles(this.project)]);
      this.meta = new Map(meta.map((m) => [m.project + '\0' + m.path, m]));
      this.files = files;
    } catch (e) {
      this.warn(`saved files unavailable, using memory only: ${(e as Error).message}`);
      this.meta = new Map(); this.files = new Map();
    }
    this.total = this.used = 0;
    for (const m of this.meta.values()) { this.total += m.size; if (m.project === this.project) this.used += m.size; }
  }

  read(key: string): string | null { return this.files.get(key) ?? null; }
  keys(prefix: string): string[] { return [...this.files.keys()].filter((k) => k.startsWith(prefix)); }

  write(key: string, value: string): void {
    const id = this.project + '\0' + key, old = this.meta.get(id)?.size ?? 0, size = utf8Len(key) + utf8Len(value);
    if (this.used - old + size > PROJECT_QUOTA) {
      this.warn(`write to "${key}" refused: project "${this.project}" would use ${this.used - old + size} of ${PROJECT_QUOTA} bytes`);
      return;
    }
    const evict: FileMeta[] = [];
    if (this.total - old + size > TOTAL_QUOTA) {
      const others = [...this.meta.values()].filter((m) => m.project !== this.project).sort((a, b) => a.mtime - b.mtime);
      for (const m of others) {
        if (this.total - old + size <= TOTAL_QUOTA) break;
        evict.push(m); this.drop(m);
      }
    }
    const meta: FileMeta = { project: this.project, path: key, size, mtime: Date.now() };
    this.files.set(key, value); this.meta.set(id, meta);
    this.used += size - old; this.total += size - old;
    this.backend.commit(evict, { meta, data: value });
  }

  remove(key: string): void {
    const m = this.meta.get(this.project + '\0' + key);
    this.files.delete(key);
    if (!m) return;
    this.drop(m); this.used -= m.size;
    this.backend.commit([m], null);
  }

  private drop(m: FileMeta): void { this.meta.delete(m.project + '\0' + m.path); this.total -= m.size; }
}

export function memoryBackend(): Backend & { data: Map<string, { meta: FileMeta; data: string }> } {
  const data = new Map<string, { meta: FileMeta; data: string }>();
  return {
    data,
    loadMeta: async () => [...data.values()].map((r) => r.meta),
    loadFiles: async (p) => new Map([...data.values()].filter((r) => r.meta.project === p).map((r) => [r.meta.path, r.data])),
    commit(del, put) {
      for (const m of del) data.delete(m.project + '\0' + m.path);
      if (put) data.set(put.meta.project + '\0' + put.meta.path, put);
    },
  };
}

/** IndexedDB "kratience-fs": store "meta" ({project, path, size, mtime}) and "files" ({project, path, data}), both keyed [project, path]. */
export function idbBackend(name = 'kratience-fs'): Backend {
  const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
  let db: Promise<IDBDatabase> | null = null;
  const open = () => db ??= new Promise<IDBDatabase>((ok, fail) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      for (const s of ['meta', 'files']) r.result.createObjectStore(s, { keyPath: ['project', 'path'] });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
    r.onblocked = () => fail(new Error('database blocked by another tab'));
  });
  // Commits run in order: IndexedDB orders readwrite transactions on overlapping stores.
  return {
    loadMeta: async () => req((await open()).transaction('meta').objectStore('meta').getAll() as IDBRequest<FileMeta[]>),
    async loadFiles(project) {
      const rows = await req((await open()).transaction('files').objectStore('files')
        .getAll(IDBKeyRange.bound([project], [project, []])) as IDBRequest<{ path: string; data: string }[]>);
      return new Map(rows.map((r) => [r.path, r.data]));
    },
    commit(del, put) {
      open().then((d) => {
        const tx = d.transaction(['meta', 'files'], 'readwrite'), meta = tx.objectStore('meta'), files = tx.objectStore('files');
        for (const m of del) { meta.delete([m.project, m.path]); files.delete([m.project, m.path]); }
        if (put) { meta.put(put.meta); files.put({ project: put.meta.project, path: put.meta.path, data: put.data }); }
        tx.onerror = () => console.warn(`saving files failed: ${tx.error?.message}`);
      }).catch((e) => console.warn(`saving files failed: ${(e as Error).message}`));
    },
  };
}
