import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormatError, Reader, readStringAt } from '../src/io/reader.ts';
import { chunkReader, readChunks } from '../src/datawin.ts';
import { readPath, readShdr } from '../src/chunks/misc.ts';
import { bytes, form, u32 } from './util.ts';

test('reads little-endian values and tracks position', () => {
  const r = new Reader(bytes([1, 0, 0, 0, 0xff, 0xff]));
  assert.equal(r.u32(), 1);
  assert.equal(r.i16(), -1);
  assert.equal(r.pos, 6);
});

test('out-of-bounds reads throw FormatError with the offset', () => {
  const r = new Reader(bytes([1, 2, 3]));
  r.skip(2);
  assert.throws(() => r.u32(), (e) => e instanceof FormatError && e.offset === 2);
});

test('sub-readers cannot read past their range', () => {
  const sub = new Reader(bytes([1, 2, 3, 4, 5, 6, 7, 8])).sub(2);
  assert.equal(sub.u16(), 0x0201);
  assert.throws(() => sub.u8(), FormatError);
});

test('counts are capped', () => {
  assert.throws(() => new Reader(bytes([0xff, 0xff, 0xff, 0x7f])).count(1000), /exceeds cap/);
});

test('pointers must land inside the file', () => {
  assert.throws(() => new Reader(bytes([0x00, 0x10, 0, 0])).ptr(), /outside file/);
  assert.equal(new Reader(bytes([0, 0, 0, 0])).ptr(true), 0);
});

test('GM strings: pointer targets chars, length precedes them', () => {
  const buf = bytes([2, 0, 0, 0, 0x68, 0x69, 0]);
  assert.equal(readStringAt(buf, 4), 'hi');
  assert.throws(() => readStringAt(buf, 2), FormatError);
});

test('readChunks lists chunks and rejects truncated ones', () => {
  assert.deepEqual(readChunks(form([['GEN8', [1, 2]], ['STRG', []]])).map((c) => [c.name, c.size]), [['GEN8', 2], ['STRG', 0]]);
  const bad = new Uint8Array(form([['GEN8', [1, 2]]]));
  bad[12] = 99; // GEN8 claims 99 bytes
  assert.throws(() => readChunks(bad.buffer), FormatError);
  assert.throws(() => readChunks(bytes([0, 0, 0, 0])), /missing FORM/);
});

test('PATH: smooth/closed/precision and inline (x, y, speed) points; SHDR: null pointers are stripped shaders', () => {
  const f32 = (x: number) => [...new Uint8Array(new Float32Array([x]).buffer)];
  // Chunk bodies start at 16 (FORM header 8 + chunk header 8). PATH: count, pointer to the entry at 24.
  const path = [...u32(1), ...u32(24), ...u32(0), ...u32(1), ...u32(0), ...u32(4), ...u32(2), ...f32(1), ...f32(2), ...f32(100), ...f32(3.5), ...f32(4), ...f32(50)];
  const buf = form([['PATH', path], ['SHDR', [...u32(2), ...u32(0), ...u32(0)]]]), chunks = readChunks(buf);
  assert.deepEqual(readPath(chunkReader(buf, chunks, 'PATH')!), [{ name: '', smooth: true, closed: false, precision: 4, points: [[1, 2, 100], [3.5, 4, 50]] }]);
  assert.deepEqual(readShdr(chunkReader(buf, chunks, 'SHDR')!), []);
});
