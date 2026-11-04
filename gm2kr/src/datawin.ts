// data.win (IFF "FORM") chunk reader

export interface Chunk { name: string; offset: number; size: number }

export function readChunks(buf: ArrayBuffer): Chunk[] {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'FORM') throw new Error('Not a data.win file (missing FORM header)');

  const end = Math.min(8 + v.getUint32(4, true), buf.byteLength);
  const chunks: Chunk[] = [];
  for (let o = 8; o + 8 <= end; ) {
    const size = v.getUint32(o + 4, true);
    chunks.push({ name: tag(o), offset: o + 8, size });
    o += 8 + size;
  }
  return chunks;
}
