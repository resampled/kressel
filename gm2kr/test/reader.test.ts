import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormatError, Reader, readStringAt } from '../src/io/reader.ts';
import { readChunks } from '../src/datawin.ts';
import { bytes, form } from './util.ts';

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
