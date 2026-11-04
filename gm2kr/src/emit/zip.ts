// Store-only (uncompressed) zip writer. PNGs are already compressed and the .krpj is small.

import { crc32 } from './crc32.ts';
import { concat } from './textures.ts';

export function zip(files: Map<string, Uint8Array>): Uint8Array {
  const enc = new TextEncoder(), local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, data] of files) {
    const name = enc.encode(path), crc = crc32(data);
    const header = (sig: number, extra: number) => {
      const h = new Uint8Array(extra + name.length), v = new DataView(h.buffer);
      v.setUint32(0, sig, true);
      return { h, v };
    };
    const l = header(0x04034b50, 30);
    l.v.setUint16(4, 20, true); l.v.setUint16(6, 0x800, true); // version, UTF-8 names
    l.v.setUint32(14, crc, true); l.v.setUint32(18, data.length, true); l.v.setUint32(22, data.length, true);
    l.v.setUint16(26, name.length, true); l.h.set(name, 30);
    const c = header(0x02014b50, 46);
    c.v.setUint16(4, 20, true); c.v.setUint16(6, 20, true); c.v.setUint16(8, 0x800, true);
    c.v.setUint32(16, crc, true); c.v.setUint32(20, data.length, true); c.v.setUint32(24, data.length, true);
    c.v.setUint16(28, name.length, true); c.v.setUint32(42, offset, true); c.h.set(name, 46);
    local.push(l.h, data); central.push(c.h);
    offset += l.h.length + data.length;
  }
  const cd = concat(central), end = new Uint8Array(22), v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, files.size, true); v.setUint16(10, files.size, true);
  v.setUint32(12, cd.length, true); v.setUint32(16, offset, true);
  return concat([...local, cd, end]);
}
