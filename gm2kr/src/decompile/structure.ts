// Bytecode -> krpj script tree. Simulates the VM stack to rebuild expressions, and recovers
// structured control flow from the patterns GameMaker's compiler emits. Anything that doesn't
// match a known pattern fails loudly with the code entry name and address (see architecture.md).

import { Ext, Op, T, VarKind, type Instr } from './disasm.ts';
import { BUILTINS } from './builtins.ts';

export type Kr = unknown;

/** Asset names by index, for turning ids/refs into ["_as", name]. */
export interface AssetNames { objects: string[]; sprites: string[]; sounds: string[]; rooms: string[]; fonts: string[] }

export class DecompileError extends Error {}

interface Item { e: Kr; size: number; marker?: boolean }
interface Loop { brk: number; cont: number }

const SIZE: Record<number, number> = { [T.Double]: 8, [T.Float]: 4, [T.Int32]: 4, [T.Int64]: 8, [T.Bool]: 4, [T.Var]: 16, [T.String]: 16, [T.Int16]: 4 };
const BINOP: Record<number, string> = {
  [Op.add]: 'opr_add', [Op.sub]: 'opr_sub', [Op.mul]: 'opr_mul', [Op.div]: 'opr_div', [Op.rem]: 'opr_idiv', [Op.mod]: 'opr_mod',
  [Op.shl]: 'opr_shl', [Op.shr]: 'opr_shr',
};
const CMP = ['', 'opr_lt', 'opr_lte', 'opr_eq', 'opr_neq', 'opr_gte', 'opr_gt'];
const CHANGE: Record<string, string> = { opr_add: '+', opr_sub: '-', opr_mul: '*', opr_div: '/', opr_mod: '%', opr_band: '&', opr_bor: '|', opr_bxor: '^', opr_shl: '<<', opr_shr: '>>' };
/** pushref asset types (value >>> 24). Font = 6 observed in GM 2024 (see gm_gotchas.md). */
const REF_KIND: Record<number, keyof AssetNames> = { 0: 'objects', 1: 'sprites', 2: 'sounds', 3: 'rooms', 6: 'fonts' };
const PSEUDO: Record<string, Kr> = { '@@Other@@': ['_kw', 'other'], '@@This@@': ['_kw', 'self'], '@@Global@@': ['_kw', 'global'] };

export class Decompiler {
  private readonly ins: Instr[];
  private readonly at = new Map<number, number>();
  private readonly end: number;
  private readonly name: string;
  private readonly assets: AssetNames;
  readonly locals = new Set<string>();

  constructor(name: string, ins: Instr[], endAddr: number, assets: AssetNames) {
    this.name = name; this.ins = ins; this.end = endAddr; this.assets = assets;
    ins.forEach((x, i) => this.at.set(x.at, i));
    this.at.set(endAddr, ins.length);
  }

  /** The whole entry as a statement list, with `var` declarations for its locals first. */
  run(): Kr[] {
    const stack: Item[] = [];
    const body = this.block(0, this.ins.length, stack, null);
    if (stack.length) this.fail(this.ins.length - 1, `${stack.length} values left on the stack`);
    return [...[...this.locals].map((n) => ['var_local', n]), ...body];
  }

  private fail(i: number, msg: string): never {
    const a = i < this.ins.length ? this.ins[i].at : this.end;
    throw new DecompileError(`${this.name} @0x${a.toString(16)}: ${msg}`);
  }
  private idx(addr: number, from: number): number {
    const i = this.at.get(addr);
    if (i === undefined) this.fail(from, `branch into the middle of an instruction (0x${addr.toString(16)})`);
    return i;
  }
  private addr(i: number): number { return i < this.ins.length ? this.ins[i].at : this.end; }

  private pop(stack: Item[], i: number): Item {
    const v = stack.pop();
    if (!v) this.fail(i, 'stack underflow');
    return v;
  }

  /** Instance from an instance-type number (instruction operand or pushed constant). */
  private instOf(n: number, i: number): Kr | null {
    switch (n) {
      case -1: case -6: case -7: case -15: case -16: return null; // unqualified: _lv
      case -2: return ['_kw', 'other'];
      case -3: return ['_kw', 'all'];
      case -4: return ['_kw', 'noone'];
      case -5: return ['_kw', 'global'];
    }
    if (n >= 0) return ['_as', this.asset('objects', n, i)];
    this.fail(i, `unknown instance type ${n}`);
  }
  private asset(kind: keyof AssetNames, n: number, i: number): string {
    const name = this.assets[kind][n];
    if (name === undefined) this.fail(i, `${kind} index ${n} out of range`);
    return name;
  }
  /** Instance taken off the stack (stacktop/array access). -9 means "the real instance is below". */
  private popInst(stack: Item[], i: number): Kr | null {
    const v = this.pop(stack, i);
    if (v.marker) return this.pop(stack, i).e;
    if (typeof v.e === 'number') return this.instOf(v.e, i);
    return v.e;
  }
  private varRef(inst: Kr | null, ins: Instr): Kr {
    const name = ins.v!.name;
    if (ins.i16 === -7) this.locals.add(name);
    return inst === null ? ['_lv', name] : ['_iv', inst, name];
  }
  /** Target of a push/pop. For pops, `valueFirst` (pop.i.v) means the value sits above the target. */
  private target(stack: Item[], ins: Instr, i: number): Kr {
    switch (ins.vkind) {
      case VarKind.normal: return this.varRef(this.instOf(ins.i16, i), ins);
      case VarKind.stacktop: return this.varRef(this.popInst(stack, i), ins);
      case VarKind.array: {
        const index = this.pop(stack, i).e;
        return ['_ai', this.varRef(this.popInst(stack, i), ins), index];
      }
    }
    this.fail(i, `variable access kind 0x${ins.vkind.toString(16)} not supported yet`);
  }

  private dup(stack: Item[], ins: Instr, i: number): void {
    if (ins.b1 !== 0) this.fail(i, 'dup swap form not supported yet');
    let bytes = ((ins.i16 & 0xff) + 1) * SIZE[ins.t1], k = stack.length;
    while (bytes > 0 && k > 0) bytes -= stack[--k].size;
    if (bytes !== 0) this.fail(i, 'dup size does not match the stack');
    stack.push(...stack.slice(k));
  }

  /** Decompiles [from, to) as an expression: no statements, exactly one value. */
  private expr(from: number, to: number, loop: Loop | null): Item {
    const s: Item[] = [];
    const stmts = this.block(from, to, s, loop);
    if (stmts.length || s.length !== 1) this.fail(from, 'expected a single expression');
    return s[0];
  }

  private block(from: number, to: number, stack: Item[], loop: Loop | null): Kr[] {
    const out: Kr[] = [];
    for (let i = from; i < to;) {
      // Loop headers: a later branch in this range jumps back here.
      let back = -1;
      for (let j = to - 1; j > i; j--) {
        const b = this.ins[j];
        if ((b.op === Op.b || b.op === Op.bt || b.op === Op.bf) && b.target === this.ins[i].at) { back = j; break; }
      }
      if (back >= 0 && !stack.length) { i = this.loop(i, back, out); continue; }

      const ins = this.ins[i];
      switch (ins.op) {
        case Op.push: case Op.pushloc: case Op.pushglb: case Op.pushbltn: case Op.pushi:
          if (ins.t1 === T.Var) stack.push({ e: this.target(stack, ins, i), size: 16 });
          else stack.push({ e: this.constant(ins.value), size: SIZE[ins.t1], marker: ins.value === -9 && ins.op === Op.pushi });
          break;
        case Op.conv: {
          const v = this.pop(stack, i);
          const e = ins.t1 === T.Bool && typeof v.e === 'number' ? v.e !== 0 : v.e;
          stack.push({ e, size: SIZE[ins.t2] });
          break;
        }
        case Op.add: case Op.sub: case Op.mul: case Op.div: case Op.rem: case Op.mod: case Op.shl: case Op.shr:
        case Op.and: case Op.or: case Op.xor: case Op.cmp: {
          const b = this.pop(stack, i), a = this.pop(stack, i);
          const isBool = ins.t1 === T.Bool && ins.t2 === T.Bool;
          const op = ins.op === Op.cmp ? CMP[ins.b1]
            : ins.op === Op.and ? 'opr_band' : ins.op === Op.or ? 'opr_bor' : ins.op === Op.xor ? (isBool ? 'opr_xor' : 'opr_bxor')
            : BINOP[ins.op];
          if (!op) this.fail(i, 'bad comparison kind');
          const size = ins.op === Op.cmp ? 4 : Math.max(SIZE[ins.t1], SIZE[ins.t2]);
          stack.push({ e: [op, a.e, b.e], size });
          break;
        }
        case Op.neg: { const a = this.pop(stack, i); stack.push({ e: ['opr_neg', a.e], size: a.size }); break; }
        case Op.not: { const a = this.pop(stack, i); stack.push({ e: [ins.t1 === T.Bool ? 'opr_not' : 'opr_bnot', a.e], size: a.size }); break; }
        case Op.dup: this.dup(stack, ins, i); break;
        case Op.pop: {
          if (ins.t1 === T.Int16) this.fail(i, 'pop swap form not supported yet');
          const valueFirst = ins.t1 === T.Int32 && ins.vkind !== VarKind.normal;
          const value = valueFirst ? this.pop(stack, i) : null;
          const tgt = this.target(stack, ins, i);
          out.push(this.assign(tgt, (value ?? this.pop(stack, i)).e));
          break;
        }
        case Op.popz: {
          const v = this.pop(stack, i);
          if (Array.isArray(v.e) && typeof v.e[0] === 'string' && !v.e[0].startsWith('_')) out.push(v.e);
          break;
        }
        case Op.call: {
          const args: Kr[] = [];
          for (let k = 0; k < ins.i16; k++) args.push(this.pop(stack, i).e);
          stack.push({ e: this.call(ins.fn!, args, i), size: 16 });
          break;
        }
        case Op.brk: stack.push(this.ext(ins, i)); break;
        case Op.ret: out.push(['ctr_return', this.pop(stack, i).e]); break;
        case Op.exit: if (i !== this.ins.length - 1) out.push(['ctr_exit']); break;
        case Op.bf: case Op.bt: {
          if (ins.target <= ins.at) this.fail(i, 'unexpected backward branch');
          i = this.cond(i, to, stack, out, loop);
          continue;
        }
        case Op.b: {
          if (loop && ins.target === loop.brk) out.push(['ctr_break']);
          else if (loop && ins.target === loop.cont) out.push(['ctr_continue']);
          else this.fail(i, `unstructured branch to 0x${ins.target.toString(16)}`);
          break;
        }
        case Op.pushenv: { i = this.with(i, stack, out); continue; }
        default: this.fail(i, `instruction 0x${ins.op.toString(16)} not supported here`);
      }
      i++;
    }
    return out;
  }

  /** bf/bt forward: short-circuit && / ||, ternary, or if / if-else. Returns the next index. */
  private cond(i: number, to: number, stack: Item[], out: Kr[], loop: Loop | null): number {
    const ins = this.ins[i], c = this.pop(stack, i).e;
    const t = this.idx(ins.target, i);
    if (t > to) this.fail(i, 'branch leaves its block');
    const jump = t - 1 > i ? this.ins[t - 1] : null;
    const isElse = jump && jump.op === Op.b && jump.target > jump.at && this.addr(t) !== jump.target
      && !(loop && (jump.target === loop.brk || jump.target === loop.cont));

    // a && b:  a; bf F; b; b E; F: push 0; E:      a || b:  a; bt F; b; b E; F: push 1; E:
    const f = this.ins[t];
    if (jump?.op === Op.b && jump.target === this.addr(t + 1) && f && f.op === Op.pushi && f.value === (ins.op === Op.bf ? 0 : 1)) {
      const rhs = this.expr(i + 1, t - 1, loop);
      stack.push({ e: [ins.op === Op.bf ? 'opr_and' : 'opr_or', c, rhs.e], size: 4 });
      return t + 1;
    }
    const test = ins.op === Op.bf ? c : ['opr_not', c];
    if (!isElse) {
      out.push(['ctr_if', test, this.block(i + 1, t, stack, loop)]);
      return t;
    }
    const e = this.idx(jump!.target, t - 1);
    if (e > to) this.fail(t - 1, 'else branch leaves its block');
    const thenS: Item[] = [], elseS: Item[] = [];
    const thenB = this.block(i + 1, t - 1, thenS, loop), elseB = this.block(t, e, elseS, loop);
    if (thenS.length || elseS.length) { // c ? a : b
      if (thenB.length || elseB.length || thenS.length !== 1 || elseS.length !== 1) this.fail(i, 'unrecognised conditional expression');
      stack.push({ e: ['opr_cond', test, thenS[0].e, elseS[0].e], size: 16 });
    } else {
      out.push(['ctr_if', test, thenB, elseB]);
    }
    return e;
  }

  /** while (b back to top) or do/until (conditional branch back). Returns the next index. */
  private loop(top: number, back: number, out: Kr[]): number {
    const b = this.ins[back], after = this.addr(back + 1);
    if (b.op === Op.b) {
      let k = top;
      while (k < back && !(this.ins[k].op === Op.bf && this.ins[k].target === after)) k++;
      if (k === back) { // while (true)
        out.push(['ctr_while', true, this.block(top, back, [], { brk: after, cont: this.ins[top].at })]);
      } else {
        const cond = this.expr(top, k, null);
        out.push(['ctr_while', cond.e, this.block(k + 1, back, [], { brk: after, cont: this.ins[top].at })]);
      }
    } else {
      const s: Item[] = [];
      // continue inside do/until would jump to the condition, whose start isn't known here.
      const body = this.block(top, back, s, { brk: after, cont: -2 });
      if (s.length !== 1) this.fail(back, 'do/until condition not found');
      out.push(['ctr_do_until', body, b.op === Op.bf ? s[0].e : ['opr_not', s[0].e]]);
    }
    return back + 1;
  }

  /** push inst; pushenv E; body; popenv body; E: */
  private with(i: number, stack: Item[], out: Kr[]): number {
    const ins = this.ins[i], inst = this.popInst(stack, i);
    const e = this.idx(ins.target, i), pe = this.ins[e - 1];
    if (!pe || pe.op !== Op.popenv || pe.target !== this.addr(i + 1)) this.fail(i, 'with without matching popenv');
    out.push(['ctr_with', inst ?? ['_kw', 'self'], this.block(i + 1, e - 1, [], { brk: this.addr(e), cont: pe.at })]);
    return e;
  }

  private assign(tgt: Kr, value: Kr): Kr {
    // x = x op y  ->  var_change (same target, read once: matches GML's compound assignment)
    if (Array.isArray(value) && value.length === 3 && CHANGE[value[0] as string] && sameTarget(value[1], tgt)) {
      return ['var_change', CHANGE[value[0] as string], tgt, value[2]];
    }
    return ['var_set', tgt, value];
  }

  private constant(v: Instr['value']): Kr {
    if (typeof v === 'bigint') return ['_i6', String(v)];
    if (typeof v === 'number' && !Number.isFinite(v)) return ['_cn', Number.isNaN(v) ? 'NaN' : 'infinity'];
    return v;
  }

  private ext(ins: Instr, i: number): Item {
    if (ins.i16 === Ext.pushref) {
      if (ins.fn) return { e: ['_fn', ins.fn], size: 16 };
      if (typeof ins.value !== 'number') this.fail(i, 'pushref without operand');
      const kind = REF_KIND[ins.value >>> 24];
      if (!kind) this.fail(i, `pushref of unsupported asset type ${ins.value >>> 24}`);
      return { e: ['_as', this.asset(kind, ins.value & 0xffffff, i)], size: 16 };
    }
    this.fail(i, `extended opcode ${ins.i16} not supported yet`);
  }

  private call(fn: string, args: Kr[], i: number): Kr {
    if (fn in PSEUDO) return PSEUDO[fn];
    const b = BUILTINS.get(fn);
    if (b) return b.ref === null ? [b.op, ...args] : [b.op, b.ref, ...args];
    this.fail(i, `unknown function ${fn}`);
  }
}

/**
 * Whether a read and a write name the same target, such that `a = a op b` can become `a op= b`.
 * Declarations (`_lv`, `_iv`...) compare structurally; anything with side effects (an opcode call)
 * must be the very same node, i.e. evaluated once and dup'd by the compiler.
 */
function sameTarget(a: Kr, b: Kr): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  if (typeof a[0] === 'string' && !a[0].startsWith('_')) return false;
  return a.every((x, k) => sameTarget(x, b[k]));
}
