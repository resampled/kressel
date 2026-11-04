// TXTR: texture pages. The entry layout grew over versions (scaled, mips, block size, w/h/index...)
// with the data pointer always last, so the entry size is probed from where that pointer lands.

import { FormatError, type Reader } from '../io/reader.ts';

export interface TexturePage {
  /** Raw image bytes as stored: PNG, "fioq" (QOI) or "2zoq" (BZip2 + QOI). See emit/textures.ts. */
  data: Uint8Array;
}

const MAGICS = ['\x89PNG', 'fioq', '2zoq'];
const ENTRY_SIZES = [28, 16, 12, 8]; // newest first
const MAX_PAGE_BYTES = 64 << 20;

function magicAt(r: Reader, p: number): boolean {
  if (p < 0 || p + 4 > r.buf.byteLength) return false;
  const b = new Uint8Array(r.buf, p, 4);
  return MAGICS.includes(String.fromCharCode(b[0], b[1], b[2], b[3]));
}

export function readTxtr(r: Reader): TexturePage[] {
  const ptrs = r.ptrList(4096);
  if (!ptrs.length) return [];
  const size = ENTRY_SIZES.find((s) => {
    try { return magicAt(r, r.at(ptrs[0] + s - 4).u32()); } catch { return false; }
  });
  if (!size) throw new FormatError('TXTR: unrecognised texture entry layout', ptrs[0]);
  const starts = ptrs.map((p) => r.at(p + size - 4).ptr());
  // Data blobs are stored back to back; each ends where the next begins (the last at chunk end).
  const order = [...starts].sort((a, b) => a - b);
  return starts.map((s) => {
    const next = order.find((o) => o > s) ?? r.end;
    if (!magicAt(r, s)) throw new FormatError('TXTR: texture data has unknown format', s);
    if (next - s > MAX_PAGE_BYTES) throw new FormatError('TXTR: texture too large', s);
    return { data: r.at(s).bytes(next - s) };
  });
}
