import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { cropItem, decodePng, decodeQoi, encodePng } from '../src/emit/textures.ts';
import { zip } from '../src/emit/zip.ts';
import { crc32 } from '../src/emit/crc32.ts';
import { readZip } from '../../krplayer/src/loader/zip.ts';

test('crc32 matches the IEEE check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('GM QOI: colour, run and index ops', () => {
  // 3x1: COLOR(rgba 10,20,30,255), RUN of 1 more, then INDEX back to the same colour.
  const body = [0xf0 | 0x0f, 10, 20, 30, 255, 0x40, 0x00 | ((10 ^ 20 ^ 30 ^ 255) & 63)];
  const b = new Uint8Array([0x66, 0x69, 0x6f, 0x71, 3, 0, 1, 0, body.length, 0, 0, 0, ...body]);
  const img = decodeQoi(b, 0);
  assert.deepEqual([img.w, img.h], [3, 1]);
  assert.deepEqual([...img.data], [10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255]);
});

test('PNG encoder writes a valid header', async () => {
  const png = await encodePng({ w: 2, h: 1, data: new Uint8Array(8) });
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(png.buffer, png.byteOffset);
  assert.deepEqual([v.getUint32(16), v.getUint32(20)], [2, 1]);
});

test('PNG decoder reads what the encoder writes (older GM texture pages are PNG)', async () => {
  const data = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 8, 7, 6, 1, 2, 3, 4, 50, 60, 70, 80]);
  const img = await decodePng(await encodePng({ w: 3, h: 2, data }), 'test');
  assert.deepEqual([img.w, img.h, [...img.data]], [3, 2, [...data]]);
});

test('stretched / overhanging texture items are drawn into the frame like GM, clipped to it', () => {
  // A 1x1 red page pixel stretched to a 3x2 frame, and an item whose target overhangs a 2x2 frame by a pixel.
  const page = { w: 2, h: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) };
  const fill = cropItem([page], { sx: 0, sy: 0, sw: 1, sh: 1, tx: 0, ty: 0, tw: 3, th: 2, bw: 3, bh: 2, page: 0 }, 't');
  assert.deepEqual([...fill.data], Array(6).fill([255, 0, 0, 255]).flat());
  const over = cropItem([page], { sx: 0, sy: 0, sw: 2, sh: 1, tx: 1, ty: 0, tw: 2, th: 1, bw: 2, bh: 2, page: 0 }, 't');
  assert.deepEqual([...over.data.subarray(0, 8)], [0, 0, 0, 0, 255, 0, 0, 255]);
});

test('zip round-trips through the krplayer reader', async () => {
  const files = new Map([['game.json', new TextEncoder().encode('{"krpj_v":"0.1"}')], ['sprites/a/0.png', new Uint8Array([1, 2, 3])]]);
  const back = await readZip(zip(files));
  assert.deepEqual([...back.keys()], [...files.keys()]);
  assert.deepEqual([...back.get('sprites/a/0.png')!], [1, 2, 3]);
});

// Real games stay local (gitignored samples/); this runs only when the sample is present.
const ASTEROIDS = new URL('../../samples/asteroids/data.win', import.meta.url);
test('asteroids sample converts and plays headlessly', { skip: !existsSync(ASTEROIDS) && 'samples/asteroids/data.win not present' }, async () => {
  const { convert } = await import('../src/convert.ts');
  const { createHeadless } = await import('../../krplayer/src/platform/headless.ts');
  const { load } = await import('../../krplayer/src/play.ts');
  const b = readFileSync(ASTEROIDS);
  const { krpj, files } = await convert(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  assert.deepEqual(Object.keys(krpj.objects!), ['obj_bullet', 'obj_game', 'obj_player', 'obj_rock']);
  const size = (url: string): [number, number] => {
    const d = files.get(url.slice(2))!, v = new DataView(d.buffer, d.byteOffset);
    return [v.getUint32(16), v.getUint32(20)];
  };
  const p = createHeadless(size);
  const g = await load({ krpj, url: (x) => x }, p);
  for (let f = 0; f < 300; f++) { p.key(32, f % 10 === 0); p.key(38, f < 30); g.frame(); }
  assert.ok(g.instances.some((i) => i.obj.name === 'obj_game'));
  assert.ok(p.stats.draws > 1000);
});

const CH1 = new URL('../../samples/chapter1_windows/', import.meta.url);
test('Deltarune Chapter 1 converts and runs its intro headlessly', { skip: !existsSync(new URL('data.win', CH1)) && 'samples/chapter1_windows not present', timeout: 120_000 }, async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join, relative } = await import('node:path');
  const { convert } = await import('../src/convert.ts');
  const { createHeadless } = await import('../../krplayer/src/platform/headless.ts');
  const { load } = await import('../../krplayer/src/play.ts');
  const dir = fileURLToPath(CH1), extra = new Map<string, () => Promise<Uint8Array>>();
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else extra.set(relative(dir, p).replace(/\\/g, '/'), async () => readFileSync(p)); } };
  walk(dir);
  const b = readFileSync(join(dir, 'data.win'));
  const { krpj, files } = await convert(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), extra);
  // Only the music the game names is packed (mus/ holds every chapter's).
  const mus = Object.keys(krpj.included_files ?? {}).filter((p) => p.startsWith('mus/'));
  assert.ok(mus.length > 20 && mus.length < 100, `${mus.length} music files`);
  const size = (url: string): [number, number] => { const d = files.get(url.slice(2))!, v = new DataView(d.buffer, d.byteOffset); return [v.getUint32(16), v.getUint32(20)]; };
  const p = createHeadless(size, undefined, async (u) => files.get(u.slice(2))!);
  const g = await load({ krpj, url: (x) => x }, p);
  for (let f = 0; f < 900; f++) { p.tick(33); g.frame(); }
  assert.equal(g.room.name, 'PLACE_CONTACT');
  // The contact sequence advances its EVENT state as its text plays (0, 1, 2, 4, 5.1...).
  const dc = g.instances.find((i) => i.obj.name === 'DEVICE_CONTACT')!;
  assert.ok((dc.vars.get(g.a.varNames.indexOf('EVENT')) as number) >= 5, 'the intro sequence advanced');
});
