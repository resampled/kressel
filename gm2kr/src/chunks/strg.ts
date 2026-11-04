// STRG: the string table. push.s instructions index into it.

import { readStringAt, type Reader } from '../io/reader.ts';

export function readStrg(r: Reader): string[] {
  // Each pointer targets the u32 length; the chars follow it.
  return r.ptrList(1 << 20).map((p) => readStringAt(r.buf, p + 4));
}
