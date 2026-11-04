// Bytecode 15-17 disassembler: a code entry's bytes -> flat instruction list.
// Encoding per UndertaleModTool's UndertaleInstruction. Unknown opcodes fail with the address.

import { FormatError, Reader } from '../io/reader.ts';
import type { GmCode, GmRefs, GmVar } from '../chunks/code.ts';

/** Instruction data types. */
export const T = { Double: 0, Float: 1, Int32: 2, Int64: 3, Bool: 4, Var: 5, String: 6, Int16: 15 } as const;

export const Op = {
  conv: 0x07, mul: 0x08, div: 0x09, rem: 0x0a, mod: 0x0b, add: 0x0c, sub: 0x0d, and: 0x0e, or: 0x0f, xor: 0x10,
  neg: 0x11, not: 0x12, shl: 0x13, shr: 0x14, cmp: 0x15, pop: 0x45, pushi: 0x84, dup: 0x86, ret: 0x9c, exit: 0x9d,
  popz: 0x9e, b: 0xb6, bt: 0xb7, bf: 0xb8, pushenv: 0xba, popenv: 0xbb, push: 0xc0, pushloc: 0xc1, pushglb: 0xc2,
  pushbltn: 0xc3, call: 0xd9, callv: 0xda, brk: 0xff,
} as const;
const OP_NAMES = new Map<number, string>(Object.entries(Op).map(([k, v]) => [v, k]));

/** Variable reference kinds (top bits of the reference word). */
export const VarKind = { array: 0x00, stacktop: 0x80, normal: 0xa0, instance: 0xe0, pushaf: 0x10, popaf: 0x90 } as const;

/** Extended (break) opcodes. */
export const Ext = { chkindex: -1, pushaf: -2, popaf: -3, pushac: -4, setowner: -5, isstaticok: -6, setstatic: -7, savearef: -8, restorearef: -9, chknullish: -10, pushref: -11 } as const;

export interface Instr {
  at: number;
  op: number;
  t1: number; t2: number;
  /** Signed low 16 bits: instance type, pushi value, argc, dup size, comparison or ext opcode. */
  i16: number;
  /** Byte 1 (comparison kind for cmp, swap size for dup). */
  b1: number;
  /** Absolute branch target (b/bt/bf/pushenv/popenv). -1 for popenv's "exit" form. */
  target: number;
  /** Push constant. */
  value: number | string | bigint | boolean | null;
  /** Variable operand (push/pop) and its reference kind. */
  v: GmVar | null; vkind: number;
  /** Function operand (call, pushref of a function). */
  fn: string | null;
}

const MAX_INSTRS = 1 << 20;

export function disassemble(buf: ArrayBuffer, code: GmCode, refs: GmRefs, strings: string[]): Instr[] {
  const r = new Reader(buf, code.start, code.start + code.length);
  const out: Instr[] = [];
  while (r.pos < r.end) {
    if (out.length >= MAX_INSTRS) throw new FormatError(`${code.name}: too many instructions`, r.pos);
    const at = r.pos, w = r.u32();
    const op = w >>> 24, t1 = (w >>> 16) & 0xf, t2 = (w >>> 20) & 0xf, i16 = (w << 16) >> 16, b1 = (w >>> 8) & 0xff;
    const ins: Instr = { at, op, t1, t2, i16, b1, target: -1, value: null, v: null, vkind: 0, fn: null };
    const varRef = () => {
      const ref = r.u32();
      ins.vkind = (ref >>> 24) & 0xf8;
      ins.v = refs.vars.get(at) ?? null;
      if (!ins.v) throw new FormatError(`${code.name}: variable reference not found in VARI`, at);
    };
    switch (op) {
      case Op.b: case Op.bt: case Op.bf: case Op.pushenv: case Op.popenv:
        ins.target = op === Op.popenv && (w & 0x7fffff) === 0xf00000 ? -1 : at + ((w << 9) >> 9) * 4;
        break;
      case Op.pop:
        if (t1 !== T.Int16) varRef(); // pop.e.v is the 2.3 "swap" form with no operand
        break;
      case Op.push: case Op.pushloc: case Op.pushglb: case Op.pushbltn:
        switch (t1) {
          case T.Double: ins.value = r.f64(); break;
          case T.Float: ins.value = r.f32(); break;
          case T.Int32: ins.value = r.i32(); break;
          case T.Int64: ins.value = r.u64(); break;
          case T.Bool: ins.value = r.u32() !== 0; break;
          case T.Var: varRef(); break;
          case T.String: {
            const i = r.u32();
            if (i >= strings.length) throw new FormatError(`${code.name}: string index ${i} out of range`, at);
            ins.value = strings[i];
            break;
          }
          case T.Int16: ins.value = i16; break;
          default: throw new FormatError(`${code.name}: push with unknown type ${t1}`, at);
        }
        break;
      case Op.pushi: ins.value = i16; break;
      case Op.call:
        r.skip(4);
        ins.fn = refs.funcs.get(at) ?? null;
        if (!ins.fn) throw new FormatError(`${code.name}: call target not found in FUNC`, at);
        break;
      case Op.brk:
        if (i16 === Ext.pushref && t1 === T.Int32) {
          ins.fn = refs.funcs.get(at) ?? null;
          ins.value = r.i32();
        }
        break;
      default:
        if (!OP_NAMES.has(op)) throw new FormatError(`${code.name}: unknown opcode 0x${op.toString(16)}`, at);
    }
    out.push(ins);
  }
  return out;
}

const TN = 'dfilbvs????????e';
const INST: Record<number, string> = { [-1]: 'self', [-2]: 'other', [-3]: 'all', [-4]: 'noone', [-5]: 'global', [-6]: 'builtin', [-7]: 'local', [-9]: 'stacktop', [-15]: 'arg', [-16]: 'static' };

/** Human-readable listing, for debugging and golden tests. */
export function formatInstr(i: Instr): string {
  const name = i.op === Op.brk ? Object.entries(Ext).find(([, v]) => v === i.i16)?.[0] ?? `break${i.i16}` : OP_NAMES.get(i.op)!;
  let s = `${i.at.toString(16).padStart(6, '0')}  ${name}.${TN[i.t1]}${i.op === Op.pop || i.op === Op.conv || (i.op >= 0x08 && i.op <= 0x15) ? '.' + TN[i.t2] : ''}`;
  if (i.op === Op.cmp) s += ' ' + ['', 'lt', 'le', 'eq', 'neq', 'ge', 'gt'][i.b1];
  if (i.target !== -1 || i.op === Op.popenv) s += ` -> ${i.target === -1 ? 'exit' : i.target.toString(16)}`;
  if (i.v) s += ` ${INST[i.i16] ?? i.i16}.${i.v.name} [${Object.entries(VarKind).find(([, k]) => k === i.vkind)?.[0]}]`;
  else if (i.value !== null) s += ' ' + JSON.stringify(typeof i.value === 'bigint' ? String(i.value) : i.value);
  if (i.fn) s += ` ${i.fn}`;
  if (i.op === Op.call || i.op === Op.callv) s += ` argc=${i.i16}`;
  if (i.op === Op.dup) s += ` ${i.i16 & 0xff}${i.b1 ? ' swap' + i.b1 : ''}`;
  if (i.op === Op.pop && i.t1 === T.Int16) s += ` swap ${i.i16}`;
  return s;
}
