// Minimal zip reader (stored + deflate entries) for loading exported projects.
// Input is untrusted: offsets are bounds-checked and sizes capped.

const MAX_ENTRY = 256 << 20, MAX_FILES = 65536;

export class ZipError extends Error {}

async function inflateRaw(data: Uint8Array, size: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (out.length !== size) throw new ZipError('zip: entry size mismatch');
  return out;
}

export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => { if (at + 2 > bytes.length) throw new ZipError('zip: truncated'); return v.getUint16(at, true); };
  const u32 = (at: number) => { if (at + 4 > bytes.length) throw new ZipError('zip: truncated'); return v.getUint32(at, true); };
  // End of central directory: scan back over a possible comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) if (u32(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipError('not a zip file');
  const n = u16(eocd + 10);
  if (n > MAX_FILES) throw new ZipError('zip: too many entries');
  const dec = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  let at = u32(eocd + 16);
  for (let k = 0; k < n; k++) {
    if (u32(at) !== 0x02014b50) throw new ZipError('zip: bad central directory');
    const method = u16(at + 10), csize = u32(at + 20), size = u32(at + 24);
    const nameLen = u16(at + 28), extraLen = u16(at + 30), commentLen = u16(at + 32), local = u32(at + 42);
    if (at + 46 + nameLen > bytes.length) throw new ZipError('zip: truncated');
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (size > MAX_ENTRY || csize > MAX_ENTRY) throw new ZipError(`zip: ${name} too large`);
    if (u32(local) !== 0x04034b50) throw new ZipError('zip: bad local header');
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + csize > bytes.length) throw new ZipError('zip: truncated');
    const data = bytes.subarray(start, start + csize);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, await inflateRaw(data, size));
    else throw new ZipError(`zip: ${name} uses unsupported compression ${method}`);
  }
  return files;
}
