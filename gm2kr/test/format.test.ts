import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkReader, readChunks } from '../src/datawin.ts';
import { readGen8 } from '../src/chunks/gen8.ts';
import { detectFormat } from '../src/format.ts';
import { form, u32 } from './util.ts';

// GEN8 body starts at 16 and is 68 bytes; the STRG body starts at 92, so "Game"'s chars are at 96.
function game(bytecode: number, major: number, extra: [string, number[]][] = []) {
  const gen8 = [1, bytecode, 0, 0, ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(42),
    ...new Array(16).fill(0), ...u32(96), ...u32(major), ...u32(0), ...u32(0), ...u32(0), ...u32(640), ...u32(480)];
  const buf = form([['GEN8', gen8], ['STRG', [...u32(4), 0x47, 0x61, 0x6d, 0x65, 0]], ...extra]);
  const chunks = readChunks(buf);
  return { gen8: readGen8(chunkReader(buf, chunks, 'GEN8')!), chunks };
}

test('GEN8 fields', () => {
  const { gen8 } = game(17, 2);
  assert.equal(gen8.bytecodeVersion, 17);
  assert.equal(gen8.name, 'Game');
  assert.equal(gen8.gameId, 42);
  assert.deepEqual([gen8.version[0], gen8.windowWidth, gen8.windowHeight], [2, 640, 480]);
});

test('format flags', () => {
  const g1 = game(16, 1);
  assert.deepEqual(detectFormat(g1.gen8, g1.chunks), { bytecode: 16, gms2: false, gms23: false, layerEffects: false });
  const g23 = game(17, 2, [['SEQN', []]]);
  assert.deepEqual(detectFormat(g23.gen8, g23.chunks), { bytecode: 17, gms2: true, gms23: true, layerEffects: false });
});

test('unsupported bytecode fails loudly', () => {
  const g = game(13, 1);
  assert.throws(() => detectFormat(g.gen8, g.chunks), /unsupported bytecode version 13/);
});
