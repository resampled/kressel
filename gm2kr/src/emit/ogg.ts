// Optional pass over a converted project: re-encode its .ogg files smaller (as Ogg Opus). The encoder is
// passed in (WebCodecs on the page, ffmpeg from the command line), so this file has no DOM dependency.

import { concat } from './textures.ts';
import type { Progress } from './krpj.ts';

export type OggEncoder = (ogg: Uint8Array) => Promise<Uint8Array>;

/** A copy of `files` with each .ogg re-encoded. An original is kept when the result isn't smaller or can't be made. */
export async function compressOggs(
  files: Map<string, Uint8Array>, encode: OggEncoder, log: (msg: string) => void = () => {},
  progress: Progress = (_, i, n) => { if (i && i % 50 === 0) log(`  compressed ${i}/${n} .ogg files`); },
): Promise<Map<string, Uint8Array>> {
  const out = new Map(files), oggs = [...files].filter(([path]) => /\.ogg$/i.test(path));
  let before = 0, after = 0;
  for (const [i, [path, data]] of oggs.entries()) {
    progress('Compressing .ogg audio', i, oggs.length);
    let small = data;
    try { small = await encode(data); } catch (e) { log(`${path}: not compressed (${(e as Error).message})`); }
    if (small.length < data.length) out.set(path, small);
    before += data.length; after += Math.min(small.length, data.length);
  }
  const mb = (n: number) => (n / 2 ** 20).toFixed(1);
  log(`${oggs.length} .ogg files: ${mb(before)} MB -> ${mb(after)} MB`);
  return out;
}

/** Ogg's CRC-32: polynomial 0x04c11db7, not reflected (unlike zip's). */
const CRC = new Uint32Array(256).map((_, i) => {
  let r = i << 24;
  for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
  return r >>> 0;
});

/** Samples (at 48 kHz) in an Opus packet, from its TOC byte (RFC 6716 section 3.1). */
function packetSamples(p: Uint8Array): number {
  const c = p[0] >> 3, code = p[0] & 3;
  return (code === 0 ? 1 : code < 3 ? 2 : p[1] & 63) * (c < 12 ? [480, 960, 1920, 2880][c & 3] : c < 16 ? [480, 960][c & 1] : 120 << (c & 3));
}

/**
 * Opus packets -> an Ogg Opus file (RFC 7845), mono or stereo. `frames` is the length of the audio at 48 kHz:
 * the encoder's `preSkip` samples of lead-in and any padding after the end are trimmed on playback, so loops stay the same length.
 */
export function oggOpus(packets: Uint8Array[], channels: number, preSkip: number, frames: number): Uint8Array {
  const enc = new TextEncoder(), pages: Uint8Array[] = [];
  const page = (body: Uint8Array[], granule: number, flags: number) => {
    const lace = body.flatMap((p) => [...new Array<number>(Math.floor(p.length / 255)).fill(255), p.length % 255]);
    if (lace.length > 255) throw new Error('Opus packet too large for an Ogg page');
    const h = new Uint8Array(27 + lace.length), v = new DataView(h.buffer);
    h.set(enc.encode('OggS')); h[5] = flags;
    v.setUint32(6, granule >>> 0, true); v.setUint32(10, Math.floor(granule / 2 ** 32), true);
    v.setUint32(14, 0x6b72, true); v.setUint32(18, pages.length, true); // stream serial, page number
    h[26] = lace.length; h.set(lace, 27);
    const out = concat([h, ...body]);
    let crc = 0;
    for (let i = 0; i < out.length; i++) crc = ((crc << 8) ^ CRC[(crc >>> 24) ^ out[i]]) >>> 0;
    new DataView(out.buffer).setUint32(22, crc, true);
    pages.push(out);
  };
  const head = new Uint8Array(19), hv = new DataView(head.buffer);
  head.set(enc.encode('OpusHead')); head[8] = 1; head[9] = channels;
  hv.setUint16(10, preSkip, true); hv.setUint32(12, 48000, true); // then gain 0, channel mapping family 0
  page([head], 0, 2); // beginning of stream
  page([concat([enc.encode('OpusTags'), new Uint8Array([5, 0, 0, 0]), enc.encode('gm2kr'), new Uint8Array(4)])], 0, 0);

  // About a second of packets per page. A page's granule position counts the samples decoded up to its end.
  const end = preSkip + frames;
  let granule = 0, segments = 0, body: Uint8Array[] = [];
  for (const p of packets) {
    if (granule >= end) break; // padding only
    const n = Math.floor(p.length / 255) + 1;
    if (segments + n > 255 || body.length >= 50) { page(body, granule, 0); body = []; segments = 0; }
    body.push(p); segments += n; granule += packetSamples(p);
  }
  page(body, Math.min(granule, end), 4); // end of stream, trimmed to the real length
  return concat(pages);
}
