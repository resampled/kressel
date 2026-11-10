import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compressOggs, oggOpus } from '../src/emit/ogg.ts';

/** Splits an Ogg file into pages, checking each page's CRC bit by bit. */
function pages(b: Uint8Array) {
  const out: { flags: number; granule: number; packets: number[] }[] = [];
  for (let at = 0; at < b.length;) {
    assert.equal(String.fromCharCode(...b.subarray(at, at + 4)), 'OggS');
    const v = new DataView(b.buffer, b.byteOffset + at), lace = [...b.subarray(at + 27, at + 27 + b[at + 26])];
    const size = 27 + lace.length + lace.reduce((a, n) => a + n, 0), page = b.slice(at, at + size);
    page.fill(0, 22, 26);
    let crc = 0;
    for (const byte of page) {
      crc ^= byte << 24;
      for (let k = 0; k < 8; k++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    }
    assert.equal(v.getUint32(22, true), crc >>> 0);
    assert.equal(v.getUint32(18, true), out.length);
    out.push({ flags: b[at + 5], granule: v.getUint32(6, true), packets: lace });
    at += size;
  }
  return out;
}

test('oggOpus: headers, paging and end trim', () => {
  // TOC 0xf8: CELT fullband, one 20 ms frame (960 samples). 120 packets; the audio ends 100 samples into the 119th.
  const packet = (len: number) => { const p = new Uint8Array(len); p[0] = 0xf8; return p; };
  const ogg = oggOpus([...new Array(119).fill(packet(100)), packet(300)], 2, 312, 118 * 960 + 100 - 312);
  const p = pages(ogg);
  assert.deepEqual(p.map((x) => x.flags), [2, 0, 0, 0, 4]);
  assert.equal(String.fromCharCode(...ogg.subarray(28, 36)), 'OpusHead');
  assert.deepEqual([ogg[37], ogg[38] | (ogg[39] << 8)], [2, 312]); // channels, pre-skip
  assert.deepEqual(p.map((x) => x.granule), [0, 0, 50 * 960, 100 * 960, 118 * 960 + 100]);
  assert.equal(p[4].packets.length, 19); // the 120th packet is all padding: dropped
  assert.deepEqual(pages(oggOpus([packet(510)], 1, 0, 960))[2].packets, [255, 255, 0]);
});

test('compressOggs: only .ogg files, and only when smaller', async () => {
  const files = new Map([['game.json', new Uint8Array(9)], ['sounds/a.ogg', new Uint8Array(9)], ['files/mus/b.OGG', new Uint8Array(3)], ['sounds/c.ogg', new Uint8Array(9)]]);
  const out = await compressOggs(files, async (d) => { if (d === files.get('sounds/c.ogg')) throw new Error('bad'); return new Uint8Array(5); });
  assert.deepEqual([...out].map(([k, v]) => [k, v.length]), [['game.json', 9], ['sounds/a.ogg', 5], ['files/mus/b.OGG', 3], ['sounds/c.ogg', 9]]);
  assert.equal(files.get('sounds/a.ogg')!.length, 9);
});
