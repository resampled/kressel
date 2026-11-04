import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { decodeQoi, encodePng } from '../src/emit/textures.ts';
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
