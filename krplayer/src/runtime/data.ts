// ds_* data structures, json_encode/decode, ini files, text files, buffers and the virtual file
// system behind them. Saved files go to Storage (the project's partition); included files are read-only.

import type { Storage } from '../platform/types.ts';
import { GmlError, GmStruct, num, real, str, NotImplemented, Unverified, type GArray, type Value } from '../value.ts';

export const DS = { map: 1, list: 2, stack: 3, grid: 4, queue: 5, priority: 6 } as const;

/** A ds_map; json_decode marks values that are themselves maps/lists so ds_map_destroy can free them. */
export class DsMap { readonly m = new Map<Value, Value>(); }
export class DsList { a: Value[] = []; }

/** Handle tables, one id space per kind like GM. */
export class Handles<T> {
  private items: (T | null)[] = [];
  add(v: T): number {
    const i = this.items.indexOf(null);
    if (i >= 0) { this.items[i] = v; return i; }
    this.items.push(v); return this.items.length - 1;
  }
  get(id: Value, what: string): T {
    const v = typeof id === 'number' ? this.items[id] : undefined;
    // Missing ds_* is a GM error; HTML5's buffer functions return 0/nothing instead (VM unchecked).
    if (!v) throw new (what.startsWith('ds_') ? GmlError : Unverified)(`${what} ${String(id)} does not exist`);
    return v;
  }
  has(id: Value): boolean { return typeof id === 'number' && !!this.items[id]; }
  free(id: Value): void { if (typeof id === 'number' && this.items[id]) this.items[id] = null; }
}

// ---------------------------------------------------------------- virtual file system

/**
 * Paths are case-insensitive and relative to the game: "./x", "x" and working_directory + "x" are
 * the same file. Writes land in Storage; reads fall back to included files.
 */
export class Files {
  private readonly st: Storage;
  private readonly included: Map<string, Uint8Array>;
  constructor(st: Storage, included: Map<string, Uint8Array>) { this.st = st; this.included = included; }

  static norm(path: string): string {
    let p = path.replaceAll('\\', '/').toLowerCase();
    while (p.startsWith('./')) p = p.slice(2);
    return p.replace(/^\/+/, '');
  }
  exists(path: string): boolean {
    const p = Files.norm(path);
    return this.st.read(p) !== null || this.included.has(p);
  }
  readText(path: string): string | null {
    const p = Files.norm(path), saved = this.st.read(p);
    if (saved !== null) return saved.startsWith('b64:') ? new TextDecoder().decode(fromB64(saved.slice(4))) : saved;
    const inc = this.included.get(p);
    return inc ? new TextDecoder().decode(inc) : null;
  }
  readBytes(path: string): Uint8Array | null {
    const p = Files.norm(path), saved = this.st.read(p);
    if (saved !== null) return saved.startsWith('b64:') ? fromB64(saved.slice(4)) : new TextEncoder().encode(saved);
    return this.included.get(p) ?? null;
  }
  writeText(path: string, text: string): void { this.st.write(Files.norm(path), text.startsWith('b64:') ? text + ' ' : text); }
  writeBytes(path: string, b: Uint8Array): void { this.st.write(Files.norm(path), 'b64:' + toB64(b)); }
  remove(path: string): void { this.st.remove(Files.norm(path)); }
  copy(from: string, to: string): void {
    const b = this.readBytes(from);
    if (b) this.writeBytes(to, b);
  }
}

function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string): Uint8Array { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

// ---------------------------------------------------------------- JSON (ds_map API)

export class Data {
  readonly maps = new Handles<DsMap>();
  readonly lists = new Handles<DsList>();
  readonly grids = new Handles<{ w: number; h: number; a: Value[] }>();
  readonly buffers = new Handles<Buffer>();
  readonly stacks = new Handles<DsList>();
  readonly queues = new Handles<DsList>();
  /** Priority queues: values and their priorities, in insertion order. */
  readonly priorities = new Handles<{ v: Value[]; p: number[] }>();
  /** Values in maps/lists that json_decode created as nested maps/lists (by container). */
  private readonly nested = new WeakMap<object, Map<Value, 'map' | 'list'>>();

  exists(id: Value, type: number): boolean {
    switch (type) {
      case DS.map: return this.maps.has(id);
      case DS.list: return this.lists.has(id);
      case DS.grid: return this.grids.has(id);
      case DS.stack: return this.stacks.has(id);
      case DS.queue: return this.queues.has(id);
      case DS.priority: return this.priorities.has(id);
    }
    return false;
  }

  /** json_decode: objects become ds_maps, arrays ds_lists; a non-object top level is wrapped as {"default": v}. */
  jsonDecode(text: string): number {
    let v: unknown;
    try { v = JSON.parse(text); } catch { return -1; }
    if (v === null || typeof v !== 'object' || Array.isArray(v)) v = { default: v };
    return this.fromJson(v) as number;
  }
  private fromJson(v: unknown): Value {
    if (v === null) return undefined;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number' || typeof v === 'string') return v;
    const kids = new Map<Value, 'map' | 'list'>();
    const child = (x: unknown): Value => {
      const c = this.fromJson(x);
      if (x && typeof x === 'object') kids.set(c, Array.isArray(x) ? 'list' : 'map');
      return c;
    };
    if (Array.isArray(v)) {
      const l = new DsList(), id = this.lists.add(l);
      for (const x of v) l.a.push(child(x));
      this.nested.set(l, kids);
      return id;
    }
    const m = new DsMap(), id = this.maps.add(m);
    for (const [k, x] of Object.entries(v as object)) m.m.set(k, child(x));
    this.nested.set(m, kids);
    return id;
  }

  jsonEncode(map: number): string { return JSON.stringify(this.toJson(this.maps.get(map, 'ds_map'))); }
  private toJson(c: DsMap | DsList): unknown {
    const kids = this.nested.get(c);
    const conv = (x: Value): unknown => {
      const k = kids?.get(x);
      return k === 'map' ? this.toJson(this.maps.get(x, 'ds_map')) : k === 'list' ? this.toJson(this.lists.get(x, 'ds_list')) : plain(x);
    };
    if (c instanceof DsList) return c.a.map(conv);
    const o: Record<string, unknown> = {};
    for (const [k, x] of c.m) o[String(k)] = conv(x);
    return o;
  }

  /** ds_map_add_list/_map: marks a map value as a nested list/map (json_encode, ds_map_destroy). */
  nest(c: DsMap, child: Value, kind: 'map' | 'list'): void {
    let kids = this.nested.get(c);
    if (!kids) { kids = new Map(); this.nested.set(c, kids); }
    kids.set(child, kind);
  }

  /** ds_map_destroy also frees maps/lists json_decode nested inside it. */
  destroyMap(id: Value): void {
    const m = this.maps.get(id, 'ds_map');
    for (const [k, kind] of this.nested.get(m) ?? []) { if (kind === 'map') { if (this.maps.has(k)) this.destroyMap(k); } else this.lists.free(k); }
    this.maps.free(id);
  }
}

function plain(v: Value): unknown {
  if (Array.isArray(v)) return v.map(plain);
  if (v instanceof GmStruct) return undefined;
  return v;
}

/** ds_list_write / ds_map_write style serialisation (not GM's hex format; round-trips within krplayer). */
export function listWrite(l: DsList): string { return JSON.stringify(l.a.map(plain)); }
export function listRead(l: DsList, s: string): void {
  try { const a = JSON.parse(s); if (Array.isArray(a)) l.a = a as Value[]; } catch { throw new Unverified('ds_list_read: data is not from ds_list_write'); }
}

// ---------------------------------------------------------------- ini

export class Ini {
  sections = new Map<string, Map<string, string>>();
  constructor(text: string) {
    let sec: Map<string, string> | null = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith(';') || line.startsWith('#')) continue;
      const h = /^\[(.*)\]$/.exec(line);
      if (h) { sec = this.sections.get(h[1]) ?? new Map(); this.sections.set(h[1], sec); continue; }
      const eq = line.indexOf('=');
      if (eq < 0 || !sec) continue;
      let v = line.slice(eq + 1).trim();
      if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      sec.set(line.slice(0, eq).trim(), v);
    }
  }
  read(section: string, key: string): string | undefined { return this.sections.get(section)?.get(key); }
  write(section: string, key: string, value: string): void {
    let s = this.sections.get(section);
    if (!s) { s = new Map(); this.sections.set(section, s); }
    s.set(key, value);
  }
  toString(): string {
    let out = '';
    for (const [name, s] of this.sections) {
      out += `[${name}]\r\n`;
      for (const [k, v] of s) out += `${k}="${v}"\r\n`;
    }
    return out;
  }
}

/** ini_read_real: the stored text as a number, GM-style (leading number, else the default). */
export function iniReal(v: string | undefined, def: Value): Value {
  if (v === undefined) return def;
  const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(v);
  return m ? Number(m[0]) : def;
}

// ---------------------------------------------------------------- text files

export interface TextFile { path: string; mode: 'read' | 'write'; text: string; pos: number }

/** file_text_read_string: to the end of the line, without consuming the newline. */
export function readString(f: TextFile): string {
  const end = lineEnd(f.text, f.pos), s = f.text.slice(f.pos, end);
  f.pos = end;
  return s;
}
/** file_text_read_real: a number from the current position (spaces skipped). */
export function readReal(f: TextFile): number {
  const m = /^[ \t]*([-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?)/i.exec(f.text.slice(f.pos, lineEnd(f.text, f.pos)));
  if (!m) { f.pos = lineEnd(f.text, f.pos); return 0; }
  f.pos += m[0].length;
  return Number(m[1]);
}
/** file_text_readln: skips the rest of the line; returns it. */
export function readLn(f: TextFile): string {
  const end = lineEnd(f.text, f.pos), s = f.text.slice(f.pos, end);
  f.pos = end;
  if (f.text[f.pos] === '\r') f.pos++;
  if (f.text[f.pos] === '\n') f.pos++;
  return s;
}
const lineEnd = (t: string, from: number) => { const i = t.slice(from).search(/\r?\n/); return i < 0 ? t.length : from + i; };

// ---------------------------------------------------------------- buffers

export const BUF = { u8: 1, s8: 2, u16: 3, s16: 4, u32: 5, s32: 6, f16: 7, f32: 8, f64: 9, bool: 10, string: 11, u64: 12, text: 13 } as const;

export class Buffer {
  data: Uint8Array;
  view: DataView;
  pos = 0;
  /** 0 fixed, 1 grow, 2 wrap, 3 fast. */
  readonly type: number;
  readonly align: number;
  constructor(size: number, type: number, align: number) {
    this.data = new Uint8Array(Math.max(0, size)); this.view = new DataView(this.data.buffer);
    this.type = type; this.align = Math.max(1, align);
  }
  static from(bytes: Uint8Array): Buffer { const b = new Buffer(bytes.length, 1, 1); b.data.set(bytes); return b; }
  private ensure(n: number): void {
    if (this.pos + n <= this.data.length) return;
    if (this.type !== 1) throw new Unverified('buffer overflow');
    const d = new Uint8Array(Math.max(this.pos + n, this.data.length * 2));
    d.set(this.data); this.data = d; this.view = new DataView(d.buffer);
  }
  private alignPos(): void { this.pos = Math.ceil(this.pos / this.align) * this.align; }
  write(type: number, v: Value): void {
    this.alignPos();
    if (type === BUF.string || type === BUF.text) {
      const b = new TextEncoder().encode(str(v));
      this.ensure(b.length + (type === BUF.string ? 1 : 0));
      this.data.set(b, this.pos); this.pos += b.length;
      if (type === BUF.string) this.data[this.pos++] = 0;
      return;
    }
    const n = num(v), size = [0, 1, 1, 2, 2, 4, 4, 2, 4, 8, 1, 0, 8][type];
    if (!size) throw new NotImplemented(`buffer type ${type} not supported`);
    this.ensure(size);
    const d = this.view, p = this.pos;
    switch (type) {
      case BUF.u8: case BUF.bool: d.setUint8(p, n); break; case BUF.s8: d.setInt8(p, n); break;
      case BUF.u16: d.setUint16(p, n, true); break; case BUF.s16: d.setInt16(p, n, true); break;
      case BUF.u32: d.setUint32(p, n, true); break; case BUF.s32: d.setInt32(p, n, true); break;
      case BUF.f32: d.setFloat32(p, n, true); break; case BUF.f64: d.setFloat64(p, n, true); break;
      case BUF.u64: d.setBigUint64(p, BigInt(Math.trunc(n)), true); break;
      default: throw new NotImplemented(`buffer type ${type} not supported`);
    }
    this.pos += size;
  }
  /** buffer_peek: reads at offset without moving or aligning. */
  peek(offset: number, type: number): Value {
    const saved = this.pos;
    this.pos = offset;
    try { return this.read(type, false); } finally { this.pos = saved; }
  }
  read(type: number, align = true): Value {
    if (align) this.alignPos();
    if (this.type === 2 && this.data.length && this.pos >= this.data.length) this.pos %= this.data.length; // buffer_wrap
    // At or past the end GM reads "" for strings and -3 (eBuffer_OutOfBounds) otherwise (HTML5 yyb_read; error_audit.md).
    if (this.pos >= this.data.length) return type === BUF.string || type === BUF.text ? '' : -3;
    if (type === BUF.string || type === BUF.text) {
      let e = this.pos;
      while (e < this.data.length && this.data[e] !== 0) e++;
      const s = new TextDecoder().decode(this.data.subarray(this.pos, e));
      this.pos = Math.min(this.data.length, e + (type === BUF.string ? 1 : 0));
      return s;
    }
    const size = [0, 1, 1, 2, 2, 4, 4, 2, 4, 8, 1, 0, 8][type];
    if (!size) throw new NotImplemented(`buffer type ${type} not supported`);
    if (this.pos + size > this.data.length) throw new Unverified('buffer read past the end');
    const d = this.view, p = this.pos;
    this.pos += size;
    switch (type) {
      case BUF.u8: return d.getUint8(p); case BUF.bool: return d.getUint8(p) !== 0 ? 1 : 0; case BUF.s8: return d.getInt8(p);
      case BUF.u16: return d.getUint16(p, true); case BUF.s16: return d.getInt16(p, true);
      case BUF.u32: return d.getUint32(p, true); case BUF.s32: return d.getInt32(p, true);
      case BUF.f32: return d.getFloat32(p, true); case BUF.f64: return d.getFloat64(p, true);
      case BUF.u64: return Number(d.getBigUint64(p, true));
    }
    throw new NotImplemented(`buffer type ${type} not supported`);
  }
}

/** For builtins: a GML array of reals/strings from a ds_list (ds_map_keys_to_array etc.). */
export const toArray = (xs: Iterable<Value>): GArray => [...xs];
export const toIndex = (v: Value) => Math.trunc(real(v));
