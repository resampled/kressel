// Bounds-checked little-endian reader. The only code allowed to touch the raw data.win bytes.
// data.win is untrusted: every read is checked and every count is capped.

export class FormatError extends Error {
  readonly offset: number;
  constructor(msg: string, offset: number) {
    super(`${msg} (at 0x${offset.toString(16)})`);
    this.offset = offset;
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: false });

export class Reader {
  readonly buf: ArrayBuffer;
  readonly start: number;
  readonly end: number;
  private readonly v: DataView;
  pos: number;

  /** A view of [start, end) in buf. Offsets stay absolute so errors match the file. */
  constructor(buf: ArrayBuffer, start = 0, end = buf.byteLength) {
    if (start < 0 || end > buf.byteLength || start > end) throw new FormatError(`bad range ${start}..${end}`, start);
    this.buf = buf; this.start = start; this.end = end;
    this.v = new DataView(buf);
    this.pos = start;
  }

  /** Throws unless [at, at + n) lies inside this reader's range. */
  check(at: number, n: number): void {
    if (!Number.isInteger(at) || n < 0 || at < this.start || at + n > this.end) {
      throw new FormatError(`read of ${n} bytes out of bounds ${this.start.toString(16)}..${this.end.toString(16)}`, at);
    }
  }

  private take(n: number): number {
    this.check(this.pos, n);
    const at = this.pos;
    this.pos += n;
    return at;
  }

  seek(at: number): this { this.check(at, 0); this.pos = at; return this; }
  skip(n: number): this { this.take(n); return this; }
  /** A sub-reader over the next n bytes; advances past them. */
  sub(n: number): Reader { const at = this.take(n); return new Reader(this.buf, at, at + n); }

  u8(): number { return this.v.getUint8(this.take(1)); }
  u16(): number { return this.v.getUint16(this.take(2), true); }
  i16(): number { return this.v.getInt16(this.take(2), true); }
  u32(): number { return this.v.getUint32(this.take(4), true); }
  i32(): number { return this.v.getInt32(this.take(4), true); }
  f32(): number { return this.v.getFloat32(this.take(4), true); }
  f64(): number { return this.v.getFloat64(this.take(8), true); }
  u64(): bigint { return this.v.getBigUint64(this.take(8), true); }
  bytes(n: number): Uint8Array { const at = this.take(n); return new Uint8Array(this.buf, at, n); }
  tag(): string { const b = this.bytes(4); return String.fromCharCode(b[0], b[1], b[2], b[3]); }

  /** A u32 element count, rejected if over max (caps allocations driven by the file). */
  count(max: number): number {
    const at = this.pos, n = this.u32();
    if (n > max) throw new FormatError(`count ${n} exceeds cap ${max}`, at);
    return n;
  }

  /** A u32 absolute pointer, checked to land inside the whole file (0 = null when allowed). */
  ptr(nullable = false): number {
    const at = this.pos, p = this.u32();
    if (p === 0 && nullable) return 0;
    if (p >= this.buf.byteLength) throw new FormatError(`pointer 0x${p.toString(16)} outside file`, at);
    return p;
  }

  /** A pointer to a GameMaker string: the pointer targets the chars, the u32 length sits just before. */
  strPtr(maxLen = 1 << 20): string {
    const p = this.ptr(true);
    return p === 0 ? '' : readStringAt(this.buf, p, maxLen);
  }
}

/** Reads a GM string whose characters start at p (length u32 at p - 4). */
export function readStringAt(buf: ArrayBuffer, p: number, maxLen = 1 << 20): string {
  if (p < 4) throw new FormatError('string pointer before file start', p);
  const r = new Reader(buf).seek(p - 4);
  const len = r.count(maxLen);
  return utf8.decode(r.bytes(len));
}
