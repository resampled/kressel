// Texture pages -> RGBA images -> per-frame PNGs. Pure TS (plus CompressionStream) so it runs in
// browsers and Node alike. Formats: PNG (older GM), GameMaker's QOI variant ("fioq"), optionally
// BZip2-wrapped ("2zoq").

import { bunzip2 } from '../io/bzip2.ts';
import { FormatError } from '../io/reader.ts';
import { crc32 } from './crc32.ts';
import type { TpagItem } from '../chunks/tpag.ts';

export interface Image { w: number; h: number; data: Uint8Array }

const MAX_PIXELS = 16384 * 16384;
const tag = (b: Uint8Array, at = 0) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

export async function decodePage(data: Uint8Array, page: number): Promise<Image> {
  const magic = tag(data);
  if (magic === '\x89PNG') return decodePng(data, `texture page ${page}`);
  if (magic === '2zoq') {
    // "2zoq", u16 w, u16 h, (GM 2022.5+) u32 uncompressed size, then a bzip2 stream.
    const at = tag(data, 8).startsWith('BZh') ? 8 : 12;
    const w = u16(data, 4), h = u16(data, 6);
    return decodeQoi(bunzip2(data.subarray(at), w * h * 5 + 1024), page);
  }
  if (magic === 'fioq') return decodeQoi(data, page);
  throw new FormatError(`texture page ${page}: unknown texture format`, 0);
}

const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
/** Channels per PNG colour type (8-bit only): grey, RGB, palette, grey+alpha, RGBA. */
const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Decodes a PNG (8-bit, non-interlaced: what older GM texture pages use) to RGBA. */
export async function decodePng(b: Uint8Array, where: string): Promise<Image> {
  let w = 0, h = 0, type = -1, plte: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let at = 8; at + 12 <= b.length;) {
    const len = u32be(b, at), name = tag(b, at + 4);
    if (at + 12 + len > b.length) throw new FormatError(`${where}: PNG chunk ${name} runs past the end`, at);
    const body = b.subarray(at + 8, at + 8 + len);
    if (name === 'IHDR') {
      w = u32be(body, 0); h = u32be(body, 4); type = body[9];
      if (body[8] !== 8 || !PNG_CHANNELS[type] || body[12] !== 0) throw new FormatError(`${where}: PNG bit depth ${body[8]}, colour type ${type}, interlace ${body[12]} not supported`, at);
      if (w * h > MAX_PIXELS) throw new FormatError(`${where}: too large`, at);
    } else if (name === 'PLTE') plte = body;
    else if (name === 'tRNS') trns = body;
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    at += 12 + len;
  }
  if (!w || !h) throw new FormatError(`${where}: PNG without IHDR`, 0);
  if (type === 3 && !plte) throw new FormatError(`${where}: palette PNG without PLTE`, 0);
  const ch = PNG_CHANNELS[type], stride = w * ch, raw = await inflate(concat(idat), (stride + 1) * h, where);
  const out = new Uint8Array(w * h * 4);
  let cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, up = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      switch (f) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += up; break;
        case 3: v += (a + up) >> 1; break;
        case 4: { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; break; }
        default: throw new FormatError(`${where}: bad PNG filter ${f}`, 0);
      }
      cur[x] = v;
    }
    for (let x = 0, o = y * w * 4; x < w; x++, o += 4) {
      const k = x * ch;
      switch (type) {
        case 6: out[o] = cur[k]; out[o + 1] = cur[k + 1]; out[o + 2] = cur[k + 2]; out[o + 3] = cur[k + 3]; break;
        case 2: out[o] = cur[k]; out[o + 1] = cur[k + 1]; out[o + 2] = cur[k + 2]; out[o + 3] = 255; break;
        case 0: case 4: out[o] = out[o + 1] = out[o + 2] = cur[k]; out[o + 3] = type === 4 ? cur[k + 1] : 255; break;
        case 3: { const i = cur[k] * 3; out[o] = plte![i] ?? 0; out[o + 1] = plte![i + 1] ?? 0; out[o + 2] = plte![i + 2] ?? 0; out[o + 3] = trns?.[cur[k]] ?? 255; }
      }
    }
    [cur, prev] = [prev, cur];
  }
  return { w, h, data: out };
}

/** zlib inflate of exactly `size` bytes. Stops (and fails) rather than grow past it: the input is untrusted. */
async function inflate(data: Uint8Array, size: number, where: string): Promise<Uint8Array> {
  const out = new Uint8Array(size), reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  let at = 0;
  for (;;) {
    let r;
    try { r = await reader.read(); } catch { throw new FormatError(`${where}: corrupt PNG data`, 0); }
    if (r.done) break;
    if (at + r.value.length > size) { await reader.cancel(); throw new FormatError(`${where}: PNG data larger than its image`, 0); }
    out.set(r.value, at); at += r.value.length;
  }
  if (at !== size) throw new FormatError(`${where}: PNG data shorter than its image`, 0);
  return out;
}

/** GameMaker's QOI variant (an early QOI draft). Decoder after UndertaleModTool's QoiConverter. */
export function decodeQoi(b: Uint8Array, page: number): Image {
  if (b.length < 12 || tag(b) !== 'fioq') throw new FormatError(`texture page ${page}: bad QOI header`, 0);
  const w = u16(b, 4), h = u16(b, 6), end = Math.min(b.length, 12 + u32(b, 8));
  if (w * h > MAX_PIXELS) throw new FormatError(`texture page ${page}: too large`, 0);
  const out = new Uint8Array(w * h * 4), index = new Uint8Array(256);
  let pos = 12, run = 0, r = 0, g = 0, bl = 0, a = 255;
  const next = () => (pos < end ? b[pos++] : 0);
  for (let o = 0; o < out.length; o += 4) {
    if (run > 0) run--;
    else if (pos < end) {
      const b1 = next();
      if ((b1 & 0xc0) === 0x00) {
        const i = (b1 & 0x3f) << 2;
        r = index[i]; g = index[i + 1]; bl = index[i + 2]; a = index[i + 3];
      } else if ((b1 & 0xe0) === 0x40) {
        run = b1 & 0x1f;
      } else if ((b1 & 0xe0) === 0x60) {
        run = (((b1 & 0x1f) << 8) | next()) + 32;
      } else if ((b1 & 0xc0) === 0x80) {
        r += ((b1 & 48) << 26) >> 30; g += ((b1 & 12) << 28) >> 30; bl += ((b1 & 3) << 30) >> 30;
      } else if ((b1 & 0xe0) === 0xc0) {
        const m = (b1 << 8) | next();
        r += ((m & 7936) << 19) >> 27; g += ((m & 240) << 24) >> 28; bl += ((m & 15) << 28) >> 28;
      } else if ((b1 & 0xf0) === 0xe0) {
        const m = (b1 << 16) | (next() << 8) | next();
        r += ((m & 1015808) << 12) >> 27; g += ((m & 31744) << 17) >> 27; bl += ((m & 992) << 22) >> 27; a += ((m & 31) << 27) >> 27;
      } else {
        if (b1 & 8) r = next();
        if (b1 & 4) g = next();
        if (b1 & 2) bl = next();
        if (b1 & 1) a = next();
      }
      r &= 255; g &= 255; bl &= 255; a &= 255;
      const i = ((r ^ g ^ bl ^ a) & 63) << 2;
      index[i] = r; index[i + 1] = g; index[i + 2] = bl; index[i + 3] = a;
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = a;
  }
  return { w, h, data: out };
}

/** The untrimmed image of a TPAG item (bw x bh), with the stored rectangle placed at tx/ty. */
export function cropItem(pages: Image[], t: TpagItem, where: string): Image {
  const page = pages[t.page];
  if (!page) throw new FormatError(`${where}: texture page ${t.page} missing`, 0);
  if (t.sx + t.sw > page.w || t.sy + t.sh > page.h) throw new FormatError(`${where}: texture item out of bounds`, 0);
  const out = new Uint8Array(t.bw * t.bh * 4);
  if (t.sw === t.tw && t.sh === t.th && t.tx + t.tw <= t.bw && t.ty + t.th <= t.bh) {
    for (let y = 0; y < t.sh; y++) {
      const s = ((t.sy + y) * page.w + t.sx) * 4;
      out.set(page.data.subarray(s, s + t.sw * 4), ((t.ty + y) * t.bw + t.tx) * 4);
    }
    return { w: t.bw, h: t.bh, data: out };
  }
  // GM draws the page rectangle stretched to (tx, ty, tw, th), whatever the bounding size says. Tool-made
  // items (ch1_ribbit_mod) are stretched (a 1x1 fill) or overhang the frame by a pixel: clip to the frame.
  const v = new Uint32Array(out.buffer), p = new Uint32Array(page.data.buffer, page.data.byteOffset, page.w * page.h);
  for (let y = Math.max(0, -t.ty); y < t.th && t.ty + y < t.bh; y++) {
    const sy = t.sy + Math.floor((y * t.sh) / t.th);
    for (let x = Math.max(0, -t.tx); x < t.tw && t.tx + x < t.bw; x++) v[(t.ty + y) * t.bw + t.tx + x] = p[sy * page.w + t.sx + Math.floor((x * t.sw) / t.tw)];
  }
  return { w: t.bw, h: t.bh, data: out };
}

/** The raw stored rectangle of a TPAG item (used for font atlases, whose glyphs are relative to it). */
export function sourceRect(pages: Image[], t: TpagItem, where: string): Image {
  return cropItem(pages, { ...t, tx: 0, ty: 0, tw: t.sw, th: t.sh, bw: t.sw, bh: t.sh }, where);
}

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodePng(img: Image): Promise<Uint8Array> {
  const row = img.w * 4 + 1, raw = new Uint8Array(row * img.h);
  for (let y = 0; y < img.h; y++) raw.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), y * row + 1);
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, img.w); v.setUint32(4, img.h);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const chunks: [string, Uint8Array][] = [['IHDR', ihdr], ['IDAT', await zlib(raw)], ['IEND', new Uint8Array(0)]];
  const parts: Uint8Array[] = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  for (const [name, body] of chunks) {
    const c = new Uint8Array(12 + body.length), cv = new DataView(c.buffer);
    cv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) c[4 + i] = name.charCodeAt(i);
    c.set(body, 8);
    cv.setUint32(8 + body.length, crc32(c.subarray(4, 8 + body.length)));
    parts.push(c);
  }
  return concat(parts);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
