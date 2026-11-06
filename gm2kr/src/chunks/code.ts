// CODE, VARI and FUNC (bytecode 15+). Instructions refer to variables and functions through
// linked "occurrence" chains stored in VARI/FUNC; resolve them into address -> name maps here.

import { FormatError, Reader } from '../io/reader.ts';
import type { GmFormat } from '../format.ts';

export interface GmCode {
  name: string;
  /** Absolute address of the bytecode block and its length in bytes. */
  start: number; length: number;
  /** Byte offset inside the block where this entry begins (GMS2.3 child functions share a block). */
  offset: number;
  locals: number; args: number;
}

export interface GmVar { name: string; instType: number; id: number }

export interface GmRefs {
  /** Instruction address -> variable referenced by that instruction. */
  vars: Map<number, GmVar>;
  /** Instruction address -> function name called/pushed by that instruction. */
  funcs: Map<number, string>;
}

export function readCode(r: Reader): GmCode[] {
  return r.ptrList(1 << 16).map((p) => {
    const c = r.at(p);
    const name = c.strPtr(), length = c.u32(), locals = c.u16(), args = c.u16() & 0x7fff;
    const rel = c.pos, start = rel + c.i32(), offset = c.u32();
    if (start < 0 || start + length > r.buf.byteLength || offset > length) throw new FormatError(`code ${name}: bytecode out of range`, p);
    return { name, start, length, offset, locals, args };
  });
}

const MAX_OCC = 1 << 20;

/** Walks an occurrence chain. Each reference word holds the byte offset to the next occurrence. */
function walk(buf: ArrayBuffer, first: number, count: number, what: string, visit: (instr: number) => void): void {
  if (count > MAX_OCC) throw new FormatError(`${what}: too many occurrences`, first);
  const r = new Reader(buf);
  let at = first;
  for (let i = 0; i < count; i++) {
    if (at < 0 || at + 8 > buf.byteLength) throw new FormatError(`${what}: occurrence chain leaves the file`, at);
    visit(at);
    at += r.seek(at + 4).u32() & 0x07ffffff;
  }
}

export function readRefs(vari: Reader, func: Reader, fmt: GmFormat): GmRefs {
  const vars = new Map<number, GmVar>(), funcs = new Map<number, string>();
  vari.skip(12); // global/instance counts, max locals
  while (vari.end - vari.pos >= 20) {
    const v: GmVar = { name: vari.strPtr(), instType: vari.i32(), id: vari.i32() };
    const occ = vari.u32(), first = vari.i32();
    if (occ) walk(vari.buf, first, occ, `variable ${v.name}`, (at) => vars.set(at, v));
  }
  const n = func.count(1 << 16);
  for (let i = 0; i < n; i++) {
    const name = func.strPtr(), occ = func.u32(), first = func.i32();
    // GMS2.3+ FUNC's first address points at the reference word, one word after the instruction;
    // older builds point at the instruction itself.
    if (occ) walk(func.buf, fmt.gms23 ? first - 4 : first, occ, `function ${name}`, (at) => funcs.set(at, name));
  }
  return { vars, funcs };
}
