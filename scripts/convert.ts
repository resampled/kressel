// Converts a GameMaker game folder to a .krpj from the command line:
//   node scripts/convert.ts <game folder> <out.krpj> [--ogg-kbps=64]
// The same pipeline as the gm2kr page (gm2kr/src/convert.ts). --ogg-kbps re-encodes .ogg files as Opus at that
// bitrate, like the page's option, but with ffmpeg (which must be on PATH).

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { convert, type GameFiles } from '../gm2kr/src/convert.ts';
import { compressOggs } from '../gm2kr/src/emit/ogg.ts';
import { zip } from '../gm2kr/src/emit/zip.ts';

const args = process.argv.slice(2), flag = args.find((a) => a.startsWith('--ogg-kbps=')), kbps = flag ? +flag.slice(11) : 0;
const [dir, out] = args.filter((a) => a !== flag);
if (!dir || !out || (flag && !(kbps >= 16 && kbps <= 256))) { console.error('usage: node scripts/convert.ts <game folder> <out.krpj> [--ogg-kbps=16..256]'); process.exit(2); }

const ffmpegOpus = async (ogg: Uint8Array) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vn', '-map_metadata', '-1', '-c:a', 'libopus', '-b:a', `${kbps}k`, '-f', 'ogg', 'pipe:1'], { input: ogg, maxBuffer: 2 ** 30 });
  if (r.status !== 0) throw new Error(r.error?.message ?? String(r.stderr).trim());
  return r.stdout as Uint8Array;
};

const extra: GameFiles = new Map();
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else extra.set(relative(dir, p).split('\\').join('/'), async () => readFileSync(p));
  }
};
walk(dir);
const t0 = performance.now();
const win = readFileSync(join(dir, 'data.win'));
const log = (m: string) => console.log(m);
const { krpj, files: converted } = await convert(win.buffer.slice(win.byteOffset, win.byteOffset + win.byteLength), extra, log);
const files = kbps ? await compressOggs(converted, ffmpegOpus, log) : converted;
writeFileSync(out, zip(files));
console.log(`${krpj.cfg_db_relay.title}: ${files.size} files in ${Math.round(performance.now() - t0)} ms -> ${out}`);
