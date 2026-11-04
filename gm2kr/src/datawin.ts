// data.win (IFF "FORM") chunk reader

import { FormatError, Reader } from './io/reader.ts';

export interface Chunk { name: string; offset: number; size: number }

const MAX_CHUNKS = 256;

export function readChunks(buf: ArrayBuffer): Chunk[] {
  const r = new Reader(buf);
  if (buf.byteLength < 8 || r.tag() !== 'FORM') throw new FormatError('not a data.win file (missing FORM header)', 0);

  const form = r.sub(Math.min(r.u32(), buf.byteLength - 8));
  const chunks: Chunk[] = [];
  while (form.pos + 8 <= form.end) {
    const at = form.pos, name = form.tag(), size = form.u32();
    if (chunks.length >= MAX_CHUNKS) throw new FormatError(`more than ${MAX_CHUNKS} chunks`, at);
    chunks.push({ name, offset: form.pos, size });
    form.skip(size); // throws if the chunk runs past the FORM
  }
  return chunks;
}

/** A reader over one chunk's body, or null if the chunk is absent. */
export function chunkReader(buf: ArrayBuffer, chunks: Chunk[], name: string): Reader | null {
  const c = chunks.find((c) => c.name === name);
  return c ? new Reader(buf, c.offset, c.offset + c.size) : null;
}
