// Converts a GameMaker game folder to a .krpj from the command line:
//   node scripts/convert.ts <game folder> <out.krpj>
// The same pipeline as the gm2kr page (gm2kr/src/convert.ts).

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { convert, type GameFiles } from '../gm2kr/src/convert.ts';
import { zip } from '../gm2kr/src/emit/zip.ts';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: node scripts/convert.ts <game folder> <out.krpj>'); process.exit(2); }

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
const { krpj, files } = await convert(win.buffer.slice(win.byteOffset, win.byteOffset + win.byteLength), extra, (m) => console.log(m));
writeFileSync(out, zip(files));
console.log(`${krpj.cfg_db_relay.title}: ${files.size} files in ${Math.round(performance.now() - t0)} ms -> ${out}`);
