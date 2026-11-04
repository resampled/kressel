// Minimal bzip2 decoder (GameMaker's "2zoq" textures are BZip2-compressed QOI).
// Input is untrusted: every table index and length is checked and output is capped at maxOut.
// Block CRCs are not verified; a corrupt stream still can't read or write out of bounds.

export class Bzip2Error extends Error {}

class Bits {
  private pos = 0; private bit = 0;
  private readonly b: Uint8Array;
  constructor(b: Uint8Array) { this.b = b; }
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (this.pos >= this.b.length) throw new Bzip2Error('bzip2: unexpected end of data');
      v = (v << 1) | ((this.b[this.pos] >>> (7 - this.bit)) & 1);
      if (++this.bit === 8) { this.bit = 0; this.pos++; }
    }
    return v >>> 0;
  }
}

/** Canonical Huffman table (bzip2 assigns codes like deflate: by length, then symbol). */
interface Huff { count: Int32Array; sym: Int32Array }

function buildHuff(lens: Uint8Array, n: number): Huff {
  const count = new Int32Array(21), offs = new Int32Array(22), sym = new Int32Array(n);
  for (let i = 0; i < n; i++) count[lens[i]]++;
  for (let l = 1; l <= 20; l++) offs[l + 1] = offs[l] + count[l];
  for (let i = 0; i < n; i++) sym[offs[lens[i]]++] = i;
  return { count, sym };
}

function decodeSym(bits: Bits, h: Huff): number {
  let code = 0, first = 0, index = 0;
  for (let len = 1; len <= 20; len++) {
    code |= bits.read(1);
    const c = h.count[len];
    if (code - first < c) return h.sym[index + code - first];
    index += c; first = (first + c) << 1; code <<= 1;
  }
  throw new Bzip2Error('bzip2: bad Huffman code');
}

export function bunzip2(src: Uint8Array, maxOut: number): Uint8Array {
  const bits = new Bits(src);
  if (bits.read(24) !== 0x425a68) throw new Bzip2Error('bzip2: bad header');
  const level = bits.read(8) - 0x30;
  if (level < 1 || level > 9) throw new Bzip2Error('bzip2: bad block size');
  const blockMax = level * 100000;
  const tt = new Uint32Array(blockMax);
  let out = new Uint8Array(Math.min(maxOut, 1 << 20)), outLen = 0;
  const put = (b: number) => {
    if (outLen >= out.length) {
      if (outLen >= maxOut) throw new Bzip2Error('bzip2: output exceeds cap');
      const bigger = new Uint8Array(Math.min(maxOut, out.length * 2));
      bigger.set(out); out = bigger;
    }
    out[outLen++] = b;
  };

  for (;;) {
    const m1 = bits.read(24), m2 = bits.read(24);
    if (m1 === 0x177245 && m2 === 0x385090) break; // end of stream
    if (m1 !== 0x314159 || m2 !== 0x265359) throw new Bzip2Error('bzip2: bad block magic');
    bits.read(32); // block CRC
    if (bits.read(1)) throw new Bzip2Error('bzip2: randomised blocks not supported');
    const origPtr = bits.read(24);

    const seqToUnseq: number[] = [];
    const used = bits.read(16);
    for (let i = 0; i < 16; i++) {
      if (!(used & (0x8000 >>> i))) continue;
      const sub = bits.read(16);
      for (let j = 0; j < 16; j++) if (sub & (0x8000 >>> j)) seqToUnseq.push(i * 16 + j);
    }
    if (!seqToUnseq.length) throw new Bzip2Error('bzip2: empty symbol map');
    const alphaSize = seqToUnseq.length + 2;

    const nGroups = bits.read(3);
    if (nGroups < 2 || nGroups > 6) throw new Bzip2Error('bzip2: bad group count');
    const nSelectors = bits.read(15);
    if (nSelectors < 1) throw new Bzip2Error('bzip2: no selectors');
    const mtfG = [0, 1, 2, 3, 4, 5].slice(0, nGroups), selectors = new Uint8Array(nSelectors);
    for (let i = 0; i < nSelectors; i++) {
      let j = 0;
      while (bits.read(1)) if (++j >= nGroups) throw new Bzip2Error('bzip2: bad selector');
      const v = mtfG[j]; mtfG.splice(j, 1); mtfG.unshift(v);
      selectors[i] = v;
    }
    const tables: Huff[] = [];
    for (let g = 0; g < nGroups; g++) {
      const lens = new Uint8Array(alphaSize);
      let cur = bits.read(5);
      for (let i = 0; i < alphaSize; i++) {
        for (;;) {
          if (cur < 1 || cur > 20) throw new Bzip2Error('bzip2: bad code length');
          if (!bits.read(1)) break;
          cur += bits.read(1) ? -1 : 1;
        }
        lens[i] = cur;
      }
      tables.push(buildHuff(lens, alphaSize));
    }

    // Huffman + MTF + RUNA/RUNB -> tt[0..n)
    const mtf = seqToUnseq.map((_, i) => i), counts = new Int32Array(256);
    const eob = alphaSize - 1;
    let n = 0, sel = 0, left = 0, table = tables[0], run = 0, runBit = 1;
    for (;;) {
      if (left-- === 0) {
        if (sel >= nSelectors) throw new Bzip2Error('bzip2: ran out of selectors');
        table = tables[selectors[sel++]]; left = 49;
      }
      const s = decodeSym(bits, table);
      if (s <= 1) { // RUNA / RUNB
        if (runBit > blockMax) throw new Bzip2Error('bzip2: run too long');
        run += (s + 1) * runBit; runBit <<= 1;
        continue;
      }
      if (run) {
        if (n + run > blockMax) throw new Bzip2Error('bzip2: block overflow');
        const b = seqToUnseq[mtf[0]];
        counts[b] += run;
        while (run--) tt[n++] = b;
        run = 0; runBit = 1;
      }
      if (s === eob) break;
      if (n >= blockMax) throw new Bzip2Error('bzip2: block overflow');
      const idx = s - 1, v = mtf[idx];
      mtf.splice(idx, 1); mtf.unshift(v);
      const b = seqToUnseq[v];
      counts[b]++; tt[n++] = b;
    }
    if (origPtr >= n) throw new Bzip2Error('bzip2: bad origin pointer');

    // Inverse BWT, then undo the initial run-length encoding (4 equal bytes + count).
    const cf = new Int32Array(256);
    for (let i = 0, sum = 0; i < 256; i++) { cf[i] = sum; sum += counts[i]; }
    for (let i = 0; i < n; i++) { const b = tt[i] & 0xff; tt[cf[b]++] |= i << 8; }
    let pos = tt[origPtr] >>> 8, last = -1, same = 0;
    for (let k = 0; k < n; k++) {
      const e = tt[pos], b = e & 0xff;
      pos = e >>> 8;
      if (same === 4) { for (let r = 0; r < b; r++) put(last); same = 0; continue; }
      if (b === last) same++; else { last = b; same = 1; }
      put(b);
    }
  }
  return out.subarray(0, outLen);
}
