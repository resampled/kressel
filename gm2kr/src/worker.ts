// gm2kr's conversion worker: the same bundle as the page (src/index.ts picks which half runs), so converting
// and zipping never block the page. Protocol (each request answered by `done` or `error`, one at a time):
//   page -> worker  { type: 'convert', dataWin: File, extra: [path, File][] } | { type: 'zip', files: [path, bytes][] }
//   worker -> page  { type: 'log', msg } | { type: 'progress', step, done, total } | { type: 'done', ... } | { type: 'error', message }

import { convert, type GameFiles } from './convert.ts';
import { zip } from './emit/zip.ts';

export type ToWorker =
  | { type: 'convert'; dataWin: File; extra: [string, File][] }
  | { type: 'zip'; files: [string, Uint8Array][] };
export interface Summary { slug: string; title: string; counts: string }
export type FromWorker =
  | { type: 'log'; msg: string }
  | { type: 'progress'; step: string; done: number; total: number }
  | { type: 'done'; files?: [string, Uint8Array][]; summary?: Summary; zipped?: Uint8Array }
  | { type: 'error'; message: string };

/** Buffers to transfer, once each (several files can be views of one buffer, e.g. sounds in data.win). */
const buffers = (arrays: Uint8Array[]) => [...new Set(arrays.map((a) => a.buffer as ArrayBuffer))];

export function startWorker() {
  const post = (m: FromWorker, transfer: Transferable[] = []) => postMessage(m, { transfer });
  let lastStep = '', lastAt = 0;
  const progress = (step: string, done: number, total: number) => {
    const now = performance.now();
    if (step === lastStep && now - lastAt < 50) return; // throttled: every step change, else at most 20/s
    lastStep = step; lastAt = now;
    post({ type: 'progress', step, done, total });
  };

  onmessage = async (e: MessageEvent<ToWorker>) => {
    const req = e.data;
    try {
      if (req.type === 'zip') {
        const zipped = zip(new Map(req.files));
        return post({ type: 'done', zipped }, [zipped.buffer as ArrayBuffer]);
      }
      const t0 = performance.now();
      const extra: GameFiles = new Map(req.extra.map(([path, f]) => [path, async () => new Uint8Array(await f.arrayBuffer())]));
      const { krpj: k, files } = await convert(await req.dataWin.arrayBuffer(), extra, (msg) => post({ type: 'log', msg }), progress);
      const n = (o?: object) => Object.keys(o ?? {}).length;
      post({ type: 'log', msg: `converted "${k.cfg_db_relay.title}" in ${Math.round(performance.now() - t0)} ms` });
      const summary = {
        slug: k.cfg_db_relay.slug || 'game', title: k.cfg_db_relay.title,
        counts: `${n(k.objects)} objects, ${n(k.rooms)} rooms, ${n(k.functions)} functions, ${n(k.sprites)} sprites, ${n(k.sounds)} sounds, ${n(k.included_files)} included files, ${files.size} files`,
      };
      post({ type: 'done', files: [...files], summary }, buffers([...files.values()]));
    } catch (err) {
      console.error(err);
      post({ type: 'error', message: (err as Error).message });
    }
  };
}
