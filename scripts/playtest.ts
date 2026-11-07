// Headless playtest: runs a project in krplayer's headless platform with scripted input and saves screenshots.
//   node scripts/playtest.ts <project.krpj | game folder with data.win> [options] "<cmd>; <cmd>; ..."
// Options: --out <dir> (screenshots, default ./playtest-out), --room <name|index> [--direct], --shared <dir> (/sa/ assets),
//   --render-all (rasterize every frame: slow, but needed when a game builds up persistent surfaces)
// Commands (also accepted as separate args):
//   <N>f | wait <N>        run N frames             press <key> [N]   down for N frames (default 1), then up
//   hold <key> <N>         same as press             down <key> / up <key>
//   shot [name]            save the window as PNG    state [object]    room + instances (optionally one object)
//   until <secs>           run until fake time reaches secs
//   var <obj|global>.<name>  print a variable (first live instance of obj)
// Keys: A-Z, 0-9, Left Right Up Down Enter Space Shift Ctrl Alt Esc Tab Backspace F1-F12, or a number (GML key code).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHeadless } from '../krplayer/src/platform/headless.ts';
import { readZip } from '../krplayer/src/loader/zip.ts';
import { prepare } from '../krplayer/src/play.ts';
import type { Krpj } from '../krplayer/src/krpj.ts';
import { convert, type GameFiles } from '../gm2kr/src/convert.ts';
import { decodePng, encodePng } from '../gm2kr/src/emit/textures.ts';

const args = process.argv.slice(2), opt = (k: string) => { const i = args.indexOf(k); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 && !!args.splice(i, 1); };
const outDir = resolve(opt('--out') ?? 'playtest-out'), room = opt('--room'), shared = opt('--shared'), direct = flag('--direct'), renderAll = flag('--render-all');
const [input, ...rest] = args;
if (!input) { console.error('usage: node scripts/playtest.ts <project.krpj | game folder> [--out dir] [--room r] "<cmds>"'); process.exit(2); }

async function loadFiles(p: string): Promise<Map<string, Uint8Array>> {
  if (!statSync(p).isDirectory()) return readZip(readFileSync(p));
  const extra: GameFiles = new Map();
  const walk = (d: string) => { for (const f of readdirSync(d)) { const q = join(d, f); if (statSync(q).isDirectory()) walk(q); else extra.set(relative(p, q).split('\\').join('/'), async () => readFileSync(q)); } };
  walk(p);
  const win = readFileSync(join(p, 'data.win'));
  return (await convert(win.buffer.slice(win.byteOffset, win.byteOffset + win.byteLength), extra)).files;
}

const files = await loadFiles(input);
const main = files.get('game.json');
if (!main) throw new Error(`${input}: no game.json`);
const krpj: Krpj = JSON.parse(new TextDecoder().decode(main));
// Asset "URLs" stay as game.json paths; the platform reads them straight from the project files.
const bytes = async (u: string) => {
  if (u.startsWith('./')) { const b = files.get(u.slice(2)); if (b) return b; }
  else if (u.startsWith('/sa/') && shared) { const f = join(shared, u.slice(4)); if (existsSync(f)) return new Uint8Array(readFileSync(f)); }
  throw new Error(`playtest: missing file ${u}`);
};
const png = async (b: Uint8Array) => { const i = await decodePng(b, 'image'); return { w: i.w, h: i.h, data: new Uint8ClampedArray(i.data.buffer, i.data.byteOffset, i.data.byteLength) }; };
const p = createHeadless(() => [1, 1], async (u) => png(await bytes(u)), bytes, { decodeImage: png });
const g = await prepare({ krpj, url: (x) => x }, p);
g.start(room ? g.findRoom(room) : -1, direct);

const KEYS: Record<string, number> = { left: 37, up: 38, right: 39, down: 40, enter: 13, space: 32, shift: 16, ctrl: 17, alt: 18, esc: 27, escape: 27, tab: 9, backspace: 8 };
function key(k: string): number {
  const l = k.toLowerCase();
  if (KEYS[l]) return KEYS[l];
  if (/^f([1-9]|1[0-2])$/.test(l)) return 111 + +l.slice(1);
  if (/^[a-z0-9]$/.test(l)) return l.toUpperCase().charCodeAt(0);
  if (/^\d+$/.test(k)) return +k;
  throw new Error(`unknown key "${k}"`);
}

let logged = 0, shots = 0, lastRoom = '';
const flush = () => {
  for (; logged < p.stats.log.length; logged++) console.log(`  log: ${p.stats.log[logged]}`);
  const r = g.room?.name ?? '?';
  if (r !== lastRoom) { console.log(`  [frame ${g.frameCount}] room ${r}`); lastRoom = r; }
};
const frames = (n: number) => {
  // Rasterizing is ~95% of run time (profiled: ~250 ms/frame at 1000x1000), so by default only a run's last frame is drawn.
  for (let i = 0; i < n && !g.ended; i++) { p.soft!.enabled = renderAll || i === n - 1; p.tick(1000 / g.speed); g.frame(); }
  flush();
  if (g.ended) console.log(`  game ended${g.endMessage ? `: ${g.endMessage}` : ''}`);
};
async function shot(name = `shot${String(++shots).padStart(3, '0')}`) {
  const w = p.soft!.window(), f = join(outDir, `${name}.png`);
  writeFileSync(f, await encodePng({ w: w.w, h: w.h, data: new Uint8Array(w.data.buffer, w.data.byteOffset, w.data.byteLength) }));
  console.log(`  shot ${f} (frame ${g.frameCount}, ${w.w}x${w.h})`);
}
function state(obj?: string) {
  const live = g.instances.filter((i) => i.alive && (!obj || i.obj.name === obj));
  console.log(`  [frame ${g.frameCount}] room ${g.room?.name} (${g.roomIndex}), ${live.length} instance(s)`);
  const counts = new Map<string, number>();
  for (const i of live) counts.set(i.obj.name, (counts.get(i.obj.name) ?? 0) + 1);
  if (!obj) console.log('  ' + [...counts].map(([n, c]) => `${n} x${c}`).join(', '));
  else for (const i of live.slice(0, 20)) console.log(`  ${i.obj.name}#${i.id} x=${i.x.toFixed(1)} y=${i.y.toFixed(1)} angle=${i.image_angle.toFixed(0)} spr=${i.sprite?.name ?? "-"} img=${Math.floor(i.image_index)}`);
}

/** global.name, or object.name (first live instance). */
function readVar(path: string): unknown {
  const [scope, name] = path.split('.'), slot = g.a.varNames.indexOf(name);
  if (scope === 'global') return slot < 0 ? undefined : g.globalScope.vars.get(slot);
  const inst = g.instances.find((i) => i.alive && i.obj.name === scope);
  if (!inst) return `(no ${scope})`;
  const builtin = (inst as unknown as Record<string, unknown>)[name];
  return builtin !== undefined && typeof builtin !== 'function' ? builtin : slot < 0 ? undefined : inst.vars.get(slot);
}

mkdirSync(outDir, { recursive: true });
console.log(`${krpj.cfg_db_relay?.title ?? input}: ${g.a.rooms.length} rooms, ${g.speed} fps`);
flush();
const cmds = rest.join(';').split(';').map((s) => s.trim()).filter(Boolean);
try {
  for (const c of cmds) {
    const [op, a, b] = c.split(/\s+/);
    console.log(`> ${c}`);
    const fm = /^(\d+)f$/.exec(op);
    if (fm) frames(+fm[1]);
    else if (op === 'wait') frames(+a);
    else if (op === 'until') frames(Math.max(0, Math.ceil(((+a * 1000) - p.now()) * g.speed / 1000)));
    else if (op === 'press' || op === 'hold') { const k = key(a); p.key(k, true); frames(+(b ?? 1)); p.key(k, false); frames(1); }
    else if (op === 'down' || op === 'up') p.key(key(a), op === 'down');
    else if (op === 'shot') await shot(a);
    else if (op === 'state') state(a);
    else if (op === 'var') console.log(`  ${a} = ${JSON.stringify(readVar(a))}`);
    else throw new Error(`unknown command "${op}"`);
    if (g.ended) break;
  }
} catch (e) {
  console.log(`ERROR at frame ${g.frameCount} (room ${g.room?.name}): ${(e as Error).stack ?? e}`);
  flush();
  if (p.soft) await shot('error').catch(() => {});
  process.exit(1);
}
