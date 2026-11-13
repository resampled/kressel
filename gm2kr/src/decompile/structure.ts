// Bytecode -> krpj script tree. Simulates the VM stack to rebuild expressions, and recovers
// structured control flow from the patterns GameMaker's compiler emits. Anything that doesn't
// match a known pattern fails loudly with the code entry name and address (see architecture.md).
//
// Patterns (GM 2.3+ compiler, bytecode 17):
//   if:        c; bf E; then; E:                    if/else: c; bf F; then; b E; F: else; E:
//   a && b:    a; bf F; b; b E; F: push 0; E:       a || b:  a; bt F; b; b E; F: push 1; E:
//   while:     T: c; bf E; body; b T; E:            for: init; T: c; bf E; body; C: step; b T; E:
//   do/until:  T: body; c; bf T                     repeat: n; dup; push 0; cmp le; bt E; T: body; dec; bt T; E: popz
//   switch:    v; (dup; case; cmp eq; bt Lk)*; b D; bodies...; E: popz
//   with:      inst; pushenv P; body; P: popenv body
//   function:  b E; <child entry>; E: push.i fn; ...; call method

import { Ext, Op, T, VarKind, type Instr } from './disasm.ts';
import { lookupBuiltin } from './builtins.ts';

export type Kr = unknown;

/** Asset names by index, for turning ids/refs into ["_as", name]. */
export interface AssetNames {
  objects: string[]; sprites: string[]; sounds: string[]; rooms: string[]; fonts: string[];
  /**
   * Set for pre-2.3 (bytecode 16) code: script names, called by name (`call scr_x`) instead of through a
   * gml_Script_ function. Pre-2.3 code also encodes `a[i, j]` as index `i * 32000 + j`.
   */
  scripts?: Set<string>;
  /**
   * 2.3+ script assets that aren't also function names. Calling one (`call scr_x`) runs the script's global
   * body again and returns undefined (gm_gotchas.md): a call to the function gml_GlobalScript_<asset>.
   */
  scriptAssets?: Set<string>;
}
type AssetKind = Exclude<keyof AssetNames, 'scripts' | 'scriptAssets'>;

export class DecompileError extends Error {
  /** For an unstructured branch: where it jumps (lets loops retry with a for/continue target). */
  readonly target: number;
  constructor(msg: string, target = -1) { super(msg); this.target = target; }
}

interface Item { e: Kr; size: number; marker?: boolean; dup?: boolean }
interface Ctx { kind: 'loop' | 'with' | 'switch'; brk: number; cont: number; sw?: Switch; repeat?: boolean }
/**
 * A switch body being parsed: labels (instruction index -> case values, undefined = default), and its
 * end (the popz of the switch value), found either from a break (a `b` to a popz.v past the last label)
 * or as the first top-level popz with nothing to pop past the last label.
 */
interface Switch { labels: Map<number, Kr[]>; minEnd: number; end: number }

const SIZE: Record<number, number> = { [T.Double]: 8, [T.Float]: 4, [T.Int32]: 4, [T.Int64]: 8, [T.Bool]: 4, [T.Var]: 16, [T.String]: 16, [T.Int16]: 4 };
const BINOP: Record<number, string> = {
  [Op.add]: 'opr_add', [Op.sub]: 'opr_sub', [Op.mul]: 'opr_mul', [Op.div]: 'opr_div', [Op.rem]: 'opr_idiv', [Op.mod]: 'opr_mod',
  [Op.shl]: 'opr_shl', [Op.shr]: 'opr_shr',
};
const CMP = ['', 'opr_lt', 'opr_lte', 'opr_eq', 'opr_neq', 'opr_gte', 'opr_gt'];
const CHANGE: Record<string, string> = { opr_add: '+', opr_sub: '-', opr_mul: '*', opr_div: '/', opr_mod: '%', opr_band: '&', opr_bor: '|', opr_bxor: '^', opr_shl: '<<', opr_shr: '>>' };
/** pushref asset types (value >>> 24). Font = 6 observed in GM 2024 (see gm_gotchas.md). */
const REF_KIND: Record<number, AssetKind> = { 0: 'objects', 1: 'sprites', 2: 'sounds', 3: 'rooms', 6: 'fonts' };
const PSEUDO: Record<string, Kr> = { '@@Other@@': ['_kw', 'other'], '@@This@@': ['_kw', 'self'], '@@Global@@': ['_kw', 'global'], '@@NullObject@@': null };
const SCRIPT = 'gml_Script_';

const isOp = (n: Kr, name?: string): n is [string, ...Kr[]] => Array.isArray(n) && typeof n[0] === 'string' && (name === undefined || n[0] === name);
const pushesInt = (i: Instr | undefined, v: number) => !!i && (i.op === Op.pushi || (i.op === Op.push && (i.t1 === T.Int16 || i.t1 === T.Int32))) && i.value === v;

export class Decompiler {
  private readonly ins: Instr[];
  private readonly at = new Map<number, number>();
  private readonly end: number;
  private readonly name: string;
  private readonly assets: AssetNames;
  /** Start addresses of child functions defined inside this block (skipped, decompiled separately). */
  private readonly children: Set<number>;
  /** Branch target address -> indices of the backward branches to it (ascending). */
  private readonly backs = new Map<number, number[]>();
  readonly locals = new Set<string>();
  /** Names accessed as statics (instance type -16). */
  private readonly statics = new Set<string>();

  constructor(name: string, ins: Instr[], endAddr: number, assets: AssetNames, children: Set<number> = new Set()) {
    this.name = name; this.ins = ins; this.end = endAddr; this.assets = assets; this.children = children;
    ins.forEach((x, i) => {
      this.at.set(x.at, i);
      if ((x.op === Op.b || x.op === Op.bt || x.op === Op.bf) && x.target <= x.at) (this.backs.get(x.target) ?? this.backs.set(x.target, []).get(x.target)!).push(i);
    });
    this.at.set(endAddr, ins.length);
  }

  /** Decompiles instructions [from, to) (a whole entry by default), with `var` declarations first. */
  run(from = 0, to = this.ins.length): Kr[] {
    const stack: Item[] = [];
    // A trailing exit is the implicit end of the entry, unless something branches past it (`if (c) exit;` last).
    const last = this.ins[to - 1], end = this.addr(to);
    const implicit = last && last.op === Op.exit && !this.ins.some((x, k) => k >= from && k < to && x.target === end && (x.op === Op.b || x.op === Op.bt || x.op === Op.bf));
    const body = this.block(from, implicit ? to - 1 : to, stack, []);
    // A bare `other;` statement is pushed and never popped (gm_gotchas.md); it has no effect.
    while (stack.length && (isOp(stack.at(-1)!.e, '_kw') || !isOp(stack.at(-1)!.e))) stack.pop();
    if (stack.length) this.fail(to - 1, `${stack.length} values left on the stack`);
    return [...[...this.locals].map((n) => ['var_local', n]), ...body];
  }

  /** Index of an address (for child entry ranges). */
  index(addr: number): number { return this.idx(addr, 0); }

  private fail(i: number, msg: string, target = -1): never {
    const a = i < this.ins.length ? this.ins[i].at : this.end;
    throw new DecompileError(`${this.name} @0x${a.toString(16)}: ${msg}`, target);
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
  private instOf(n: number, i: number, stack: Item[]): Kr | null {
    switch (n) {
      case -1: case -6: case -7: case -15: case -16: return null; // unqualified: _lv
      case -2: return ['_kw', 'other'];
      case -3: return ['_kw', 'all'];
      case -4: return ['_kw', 'noone'];
      case -5: return ['_kw', 'global'];
      case -9: return this.popInst(stack, i);
    }
    if (n >= 0) return ['_as', this.asset('objects', n, i)];
    this.fail(i, `unknown instance type ${n}`);
  }
  private asset(kind: AssetKind, n: number, i: number): string {
    const name = this.assets[kind][n];
    if (name === undefined) this.fail(i, `${kind} index ${n} out of range`);
    return name;
  }
  /** Instance taken off the stack (stacktop/array access). -9 means "the real instance is below". */
  private popInst(stack: Item[], i: number): Kr | null {
    const v = this.pop(stack, i);
    if (v.marker) return this.pop(stack, i).e;
    if (typeof v.e === 'number') return this.instOf(v.e, i, stack);
    return v.e;
  }
  private varRef(inst: Kr | null, ins: Instr): Kr {
    const name = ins.v!.name;
    if (ins.i16 === -7) this.locals.add(name);
    if (ins.i16 === -16) this.statics.add(name);
    return inst === null ? ['_lv', name] : ['_iv', inst, name];
  }
  /** Target of a push/pop. */
  private target(stack: Item[], ins: Instr, i: number): Kr {
    switch (ins.vkind) {
      case VarKind.normal: return this.varRef(this.instOf(ins.i16, i, stack), ins);
      case VarKind.stacktop: return this.varRef(this.popInst(stack, i), ins);
      // A room instance by id: the operand is the id minus 100000 (gm_gotchas.md).
      case VarKind.instance: return this.varRef(100000 + ins.i16, ins);
      case VarKind.array: case VarKind.pushaf: case VarKind.popaf: {
        // [inst, index] -> var[index]; pushaf/popaf push the row for a following [j] access.
        const index = this.pop(stack, i).e, arr = this.varRef(this.popInst(stack, i), ins);
        // Pre-2.3 2D access a[i, j]: i; chkindex; push 32000; mul; j; chkindex; add. Read as a[i][j], as GMS2.3 imports it.
        if (this.assets.scripts && isOp(index, 'opr_add') && isOp(index[1], 'opr_mul') && index[1][2] === 32000) return ['_ai', ['_ai', arr, index[1][1]], index[2]];
        return ['_ai', arr, index];
      }
    }
    this.fail(i, `variable access kind 0x${ins.vkind.toString(16)} not supported yet`);
  }

  /** dup n: copies the top (n+1) units. Swap form: moves the top n units below the next m units. */
  private dup(stack: Item[], ins: Instr, i: number): void {
    const unit = SIZE[ins.t1], n = ins.i16 & 0xff;
    const take = (bytes: number): number => {
      let k = stack.length;
      while (bytes > 0 && k > 0) bytes -= stack[--k].size;
      if (bytes !== 0) this.fail(i, 'dup size does not match the stack');
      return k;
    };
    if (ins.b1 & 0x80) {
      const m = (ins.b1 & 0x7f) >> 3, k = take(n * unit), top = stack.splice(k);
      const j = take(m * unit);
      stack.splice(j, 0, ...top);
      return;
    }
    const k = take((n + 1) * unit);
    // Both copies are marked: whichever one a popz discards, it isn't a statement of its own.
    for (let j = k; j < stack.length; j++) stack[j] = { ...stack[j], dup: true };
    stack.push(...stack.slice(k));
  }

  /** Decompiles [from, to) as an expression: no statements, exactly one value. */
  private expr(from: number, to: number, ctx: Ctx[]): Item {
    const s: Item[] = [];
    const stmts = this.block(from, to, s, ctx);
    if (stmts.length || s.length !== 1) this.fail(from, 'expected a single expression');
    return s[0];
  }

  /** The last branch in (i, to) jumping back to i, or -1. */
  private backBranch(i: number, to: number): number {
    const list = this.backs.get(this.ins[i].at);
    if (list) for (let k = list.length - 1; k >= 0; k--) if (list[k] < to && list[k] > i) return list[k];
    return -1;
  }

  private block(from: number, to: number, stack: Item[], ctx: Ctx[], sw?: Switch): Kr[] {
    const out: Kr[] = [];
    for (let i = from; i < to;) {
      if (sw && i === sw.end) break;
      if (sw?.labels.has(i)) for (const v of sw.labels.get(i)!) out.push(v === undefined ? ['ctr_default'] : ['ctr_case', v]);
      const ins = this.ins[i];
      if (!stack.length) {
        const back = this.backBranch(i, to);
        if (back >= 0) { i = this.loop(i, back, out, ctx); continue; }
      }
      switch (ins.op) {
        case Op.push: case Op.pushloc: case Op.pushglb: case Op.pushbltn: case Op.pushi:
          if (ins.t1 === T.Var) stack.push({ e: this.target(stack, ins, i), size: 16 });
          else if (ins.fn) stack.push({ e: this.fnRef(ins.fn), size: SIZE[ins.t1] });
          else stack.push({ e: this.constant(ins.value), size: SIZE[ins.t1], marker: ins.value === -9 && ins.op === Op.pushi });
          break;
        case Op.conv: {
          const v = this.pop(stack, i);
          const e = (ins.t1 === T.Bool || ins.t2 === T.Bool) && typeof v.e === 'number' ? v.e > 0.5 : v.e;
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
        case Op.dup: {
          if (stack.length && (ins.i16 & 0xff) === 0 && !(ins.b1 & 0x80)) {
            const r = ins.t1 === T.Var ? this.switchStmt(i, to, stack, out, ctx) : this.repeat(i, to, stack, out, ctx);
            if (r >= 0) { i = r; continue; }
          }
          this.dup(stack, ins, i);
          break;
        }
        case Op.pop: {
          if (ins.t1 === T.Int16) this.fail(i, 'pop swap form not supported yet');
          const valueFirst = ins.t1 === T.Int32 && (ins.vkind !== VarKind.normal || ins.i16 === -9);
          const value = valueFirst ? this.pop(stack, i) : null;
          const tgt = this.target(stack, ins, i);
          const v = (value ?? this.pop(stack, i)).e;
          // `{...}` literals cache their constructor in a static (___struct___N); that's an implementation detail.
          if (ins.i16 === -16 && ins.v!.name.startsWith('___struct___')) break;
          // ++x / x++ as an expression: `x; 1; add; dup; pop x` leaves the new value, `x; dup; 1; add; pop x` the old.
          const top = stack.at(-1);
          if (top?.dup && (isOp(v, 'opr_add') || isOp(v, 'opr_sub')) && v[2] === 1 && sameTarget(v[1], tgt) && (top.e === v || top.e === v[1])) {
            stack[stack.length - 1] = { e: [v[0] === 'opr_add' ? 'var_inc' : 'var_dec', tgt, ...(top.e === v ? [] : [true])], size: top.size };
            break;
          }
          out.push(this.assign(tgt, v));
          break;
        }
        case Op.popz: {
          if (!stack.length) {
            const next = i + 1 < to ? this.ins[i + 1].op : -1;
            if (sw && sw.end < 0 && i >= sw.minEnd && next !== Op.exit && next !== Op.ret) { sw.end = i; return out; }
            // A switch value popped before leaving the switch early (exit / continue): bookkeeping only.
            if (ctx.some((c) => c.kind === 'switch')) break;
            // Likewise a repeat counter popped before exit/return inside the repeat (gm_gotchas.md).
            if (ins.t1 === T.Int32 && (next === Op.exit || next === Op.ret || next === Op.push) && ctx.some((c) => c.repeat)) break;
          }
          const v = this.pop(stack, i);
          if (!v.dup && isOp(v.e) && !v.e[0].startsWith('_')) out.push(v.e);
          break;
        }
        case Op.call: {
          if (ins.fn === '@@try_hook@@') { i = this.tryStmt(i, to, stack, out, ctx); continue; }
          const args: Kr[] = [];
          for (let k = 0; k < ins.i16; k++) args.push(this.pop(stack, i).e);
          stack.push({ e: this.call(ins.fn!, args, i), size: 16 });
          break;
        }
        case Op.callv: {
          const f = this.pop(stack, i).e, self = this.pop(stack, i).e, args: Kr[] = [];
          for (let k = 0; k < ins.i16; k++) args.push(this.pop(stack, i).e);
          const bound = isOp(f, '_iv') ? f[1] === self || (typeof self === 'number' && isOp(f[1], '_as') && f[1][1] === this.assets.objects[self])
            // a[i](): the function value is dup'ed as its own self, so it runs bound, or on the current self (gm_gotchas.md)
            : (isOp(self, '_kw') && self[1] === 'self') || self === f;
          if (!bound) this.fail(i, 'method call on an instance other than the one holding the method');
          stack.push({ e: ['fnc_m', f, ...args], size: 16 });
          break;
        }
        case Op.brk: {
          // static init: isstaticok; bt E; <static.x = v ...>; E: setstatic. Each static.x = v becomes var_static.
          if (ins.i16 === Ext.isstaticok) {
            const bt = this.ins[i + 1], e = bt?.op === Op.bt ? this.idx(bt.target, i) : -1;
            if (e < 0 || e > to || this.ins[e]?.op !== Op.brk || this.ins[e].i16 !== Ext.setstatic) this.fail(i, 'isstaticok without its static block');
            const s: Item[] = [];
            for (const st of this.block(i + 2, e, s, ctx)) {
              if (!isOp(st, 'var_set') || !isOp(st[1], '_lv') || !this.statics.has(st[1][1] as string)) this.fail(i, 'static block holds more than static initialisers');
              out.push(['var_static', st[1][1], st[2]]);
            }
            if (s.length) this.fail(i, 'static block leaves values on the stack');
            i = e + 1;
            continue;
          }
          // a ?? b (and a ??= b, which stores the result back into a): a; chknullish; bf E; popz; b; E:
          if (ins.i16 === Ext.chknullish) {
            const bf = this.ins[i + 1], e = bf?.op === Op.bf ? this.idx(bf.target, i) : -1;
            if (e < 0 || e > to || this.ins[i + 2]?.op !== Op.popz) this.fail(i, 'chknullish without its ?? pattern');
            const a = this.pop(stack, i).e;
            stack.push({ e: ['opr_nullish', a, this.expr(i + 3, e, ctx).e], size: 16 });
            i = e;
            continue;
          }
          this.ext(ins, i, stack, out);
          break;
        }
        case Op.ret: out.push(['ctr_return', this.pop(stack, i).e]); break;
        case Op.exit: out.push(['ctr_exit']); break;
        case Op.bf: case Op.bt: {
          if (ins.target <= ins.at) this.fail(i, 'unexpected backward branch');
          i = this.cond(i, to, stack, out, ctx);
          continue;
        }
        case Op.b: {
          if (ins.target > ins.at && this.children.has(this.addr(i + 1))) { i = this.idx(ins.target, i); continue; }
          if (ins.target === this.addr(i + 1)) break; // empty else {}
          // A switch with no cases (only a default, or empty): v; b D; b E; D: body; E: popz.v
          const es = stack.length ? this.caselessSwitch(i, to, stack, out, ctx) : -1;
          if (es >= 0) { i = es; continue; }
          const c = this.jumpKind(ins.target, ctx);
          if (!c) this.fail(i, `unstructured branch to 0x${ins.target.toString(16)}`, ins.target);
          out.push([c]);
          break;
        }
        case Op.pushenv: { i = this.with(i, stack, out, ctx); continue; }
        // `return`/`exit` inside `with` leaves the with first (popenv's exit form); ctr_return/ctr_exit do that.
        case Op.popenv:
          if (ins.target !== -1 || !ctx.some((c) => c.kind === 'with')) this.fail(i, 'popenv outside its with');
          break;
        default: this.fail(i, `instruction 0x${ins.op.toString(16)} not supported here`);
      }
      i++;
    }
    return out;
  }

  /** A `b` to this target is a break or continue of the innermost matching context. */
  private jumpKind(target: number, ctx: Ctx[]): 'ctr_break' | 'ctr_continue' | null {
    const inner = ctx.at(-1);
    if (inner && (target === inner.brk || this.switchEnd(inner, target))) return 'ctr_break';
    for (let k = ctx.length - 1; k >= 0; k--) if (ctx[k].kind !== 'switch') return target === ctx[k].cont ? 'ctr_continue' : null;
    return null;
  }
  private isJumpOut(target: number, ctx: Ctx[]): boolean { return ctx.some((c) => c.brk === target || c.cont === target || this.switchEnd(c, target)); }

  /** Whether target is (and, once seen, fixes) the end of a switch whose end isn't known yet. */
  private switchEnd(c: Ctx, target: number): boolean {
    if (c.kind !== 'switch' || !c.sw || c.sw.end >= 0) return false;
    const k = this.at.get(target);
    if (k === undefined || k < c.sw.minEnd || this.ins[k]?.op !== Op.popz || this.ins[k].t1 !== T.Var) return false;
    c.sw.end = k; c.brk = target;
    return true;
  }

  /** bf/bt forward: short-circuit && / ||, ternary, or if / if-else. Returns the next index. */
  private cond(i: number, to: number, stack: Item[], out: Kr[], ctx: Ctx[]): number {
    const ins = this.ins[i], c = this.pop(stack, i).e;
    const t = this.idx(ins.target, i);
    if (t > to) this.fail(i, 'branch leaves its block');
    const jump = t - 1 > i ? this.ins[t - 1] : null;
    const isElse = !!jump && jump.op === Op.b && jump.target > jump.at && this.addr(t) !== jump.target && !this.isJumpOut(jump.target, ctx)
      && !this.children.has(jump.at + 4);

    // a && b:  a; bf F; b; b E; F: push 0; E:      a || b:  a; bt F; b; b E; F: push 1; E:
    // Longer chains share F: a && b && c is a; bf F; b; bf F; c; b E; F: push 0; E:
    if (jump?.op === Op.b && jump.target === this.addr(t + 1) && pushesInt(this.ins[t], ins.op === Op.bf ? 0 : 1)) {
      const op = ins.op === Op.bf ? 'opr_and' : 'opr_or';
      let e = c, from = i + 1;
      for (let k = i + 1; k < t - 1; k++) {
        if (this.ins[k].op === ins.op && this.ins[k].target === ins.target) { e = [op, e, this.expr(from, k, ctx).e]; from = k + 1; }
      }
      stack.push({ e: [op, e, this.expr(from, t - 1, ctx).e], size: 4 });
      return t + 1;
    }
    const test = ins.op === Op.bf ? c : ['opr_not', c];
    if (!isElse) {
      const s: Item[] = [];
      const body = this.block(i + 1, t, s, ctx);
      if (s.length) this.fail(i, 'conditional leaves values on the stack');
      this.orphans(stack, out);
      out.push(['ctr_if', test, body]);
      return t;
    }
    const e = this.idx(jump!.target, t - 1);
    if (e > to) this.fail(t - 1, 'else branch leaves its block', jump!.target);
    const thenS: Item[] = [], elseS: Item[] = [];
    const thenB = this.block(i + 1, t - 1, thenS, ctx), elseB = this.block(t, e, elseS, ctx);
    if (thenS.length || elseS.length) { // c ? a : b
      if (thenB.length || elseB.length || thenS.length !== 1 || elseS.length !== 1) this.fail(i, 'unrecognised conditional expression');
      stack.push({ e: ['opr_cond', test, thenS[0].e, elseS[0].e], size: 16 });
    } else {
      this.orphans(stack, out);
      out.push(['ctr_if', test, thenB, elseB]);
    }
    return e;
  }

  /**
   * Values still on the stack when an if statement starts can only be calls whose result was never
   * popped (the compiler that built ch1_ribbit_mod sometimes omits the popz): they're statements.
   */
  private orphans(stack: Item[], out: Kr[]): void {
    if (stack.every((v) => !v.dup && isOp(v.e) && !v.e[0].startsWith('_'))) for (const v of stack.splice(0)) out.push(v.e);
  }

  /**
   * while / for (b back to the top) or do/until (conditional branch back). Returns the next index.
   * A `continue` in a for (or do/until) jumps forward to the step (or condition); the first attempt
   * assumes a while, and an unstructured branch into the loop's tail makes it retry with that target.
   */
  private loop(top: number, back: number, out: Kr[], ctx: Ctx[]): number {
    const b = this.ins[back], after = this.addr(back + 1), topAddr = this.ins[top].at;
    const retry = (attempt: (cont: number) => Kr): Kr => {
      let cont = this.stepStart(top, back);
      const tried = new Set<number>();
      let first: DecompileError | undefined;
      for (;;) {
        try { return attempt(cont); } catch (e) {
          if (!(e instanceof DecompileError)) throw e;
          // Report the first (best-guess) attempt's error: later fallbacks fail for less useful reasons.
          first ??= e;
          tried.add(cont);
          const t = e.target;
          if (t > topAddr && t <= b.at && !tried.has(t)) cont = t;
          else if (!tried.has(-1)) cont = -1;
          else throw first;
        }
      }
    };
    if (b.op === Op.b) {
      let k = top;
      while (k < back && !(this.ins[k].op === Op.bf && this.ins[k].target === after)) k++;
      const cond = k === back ? true : this.expr(top, k, ctx).e;
      const bodyFrom = k === back ? top : k + 1;
      out.push(retry((cont) => {
        if (cont < 0) return ['ctr_while', cond, this.block(bodyFrom, back, [], [...ctx, { kind: 'loop', brk: after, cont: topAddr }])];
        const c = this.idx(cont, back), inner = [...ctx, { kind: 'loop' as const, brk: after, cont }];
        return ['ctr_for', [], cond, this.block(c, back, [], inner), this.block(bodyFrom, c, [], inner)];
      }));
    } else {
      out.push(retry((cont) => {
        const condFrom = cont < 0 ? -1 : this.idx(cont, back), inner = [...ctx, { kind: 'loop' as const, brk: after, cont: cont < 0 ? -2 : cont }];
        let body: Kr[], c: Kr;
        if (condFrom < 0) {
          const s: Item[] = [];
          body = this.block(top, back, s, inner);
          if (s.length !== 1) this.fail(back, 'do/until condition not found');
          c = s[0].e;
        } else {
          body = this.block(top, condFrom, [], inner);
          c = this.expr(condFrom, back, ctx).e;
        }
        return ['ctr_do_until', body, b.op === Op.bf ? c : ['opr_not', c]];
      }));
    }
    return back + 1;
  }

  /**
   * The likely `continue` target of a for (its step) or do/until (its condition): a forward `b` from the
   * body lands there, and nothing from there to the back branch branches or is branched into. -1 if none.
   */
  private stepStart(top: number, back: number): number {
    const targets = new Set<number>();
    for (let k = top; k < back; k++) {
      const b = this.ins[k];
      if (b.op === Op.b && b.target > b.at && b.target < this.ins[back].at && b.target > this.ins[top].at) targets.add(b.target);
    }
    let best = -1;
    for (const t of targets) {
      const from = this.idx(t, back);
      let ok = true;
      for (let k = from; k < back && ok; k++) {
        const op = this.ins[k].op;
        if (op === Op.b || op === Op.bt || op === Op.bf || op === Op.pushenv || op === Op.popenv) ok = false;
      }
      for (let k = top; k < back && ok; k++) {
        const b = this.ins[k];
        if ((b.op === Op.b || b.op === Op.bt || b.op === Op.bf) && b.target > t && b.target < this.ins[back].at) ok = false;
      }
      if (ok && (best < 0 || t < best)) best = t;
    }
    return best;
  }

  /** count; dup.i 0; push 0; cmp le; bt E; T: body; push 1; sub; dup.i 0; conv; bt T; E: popz.i */
  private repeat(i: number, to: number, stack: Item[], out: Kr[], ctx: Ctx[]): number {
    const [p0, cmp, bt] = [this.ins[i + 1], this.ins[i + 2], this.ins[i + 3]];
    if (!pushesInt(p0, 0) || cmp?.op !== Op.cmp || cmp.b1 !== 2 || bt?.op !== Op.bt) return -1;
    const e = this.idx(bt.target, i + 3), back = e - 1;
    if (e > to || this.ins[e].op !== Op.popz || this.ins[back].op !== Op.bt || this.ins[back].target !== this.addr(i + 4)) return -1;
    const dec = back - 4;
    if (!pushesInt(this.ins[dec], 1) || this.ins[dec + 1].op !== Op.sub) this.fail(i, 'unrecognised repeat loop');
    const n = this.pop(stack, i).e;
    out.push(['ctr_repeat', n, this.block(i + 4, dec, [], [...ctx, { kind: 'loop', brk: this.addr(e), cont: this.addr(dec), repeat: true }])]);
    return e + 1;
  }

  /** A switch with no cases whose `b D` is at i (see the `b` case): the next index, or -1 if it isn't one. */
  private caselessSwitch(i: number, to: number, stack: Item[], out: Kr[], ctx: Ctx[]): number {
    const dead = this.ins[i + 1];
    if (dead?.op !== Op.b || dead.target <= dead.at || this.ins[i].target !== this.addr(i + 2)) return -1;
    const e = this.at.get(dead.target);
    if (e === undefined || e > to || this.ins[e].op !== Op.popz || this.ins[e].t1 !== T.Var) return -1;
    const sw: Switch = { labels: new Map([[i + 2, [undefined]]]), minEnd: e, end: e }, s: Item[] = [];
    const value = this.pop(stack, i).e, body = this.block(i + 2, e, s, [...ctx, { kind: 'switch', brk: dead.target, cont: -1, sw }], sw);
    if (s.length) this.fail(e, 'switch body leaves values on the stack');
    if (i + 2 === e) body.push(['ctr_default']);
    out.push(['ctr_switch', value, body]);
    return e + 1;
  }

  /** v; (dup.v 0; case; cmp eq; bt Lk)*; b D; bodies; E: popz.v. Returns the next index, or -1 if not a switch. */
  private switchStmt(i: number, to: number, stack: Item[], out: Kr[], ctx: Ctx[]): number {
    const cases: [Kr, number][] = [];
    let j = i;
    while (this.ins[j]?.op === Op.dup && this.ins[j].t1 === T.Var && (this.ins[j].i16 & 0xff) === 0 && !this.ins[j].b1) {
      let k = j + 1;
      while (k < to && !(this.ins[k].op === Op.cmp && this.ins[k].b1 === 3 && this.ins[k + 1]?.op === Op.bt)) {
        if (this.ins[k].op === Op.bt || this.ins[k].op === Op.bf || this.ins[k].op === Op.b || this.ins[k].op === Op.pop) return cases.length ? this.fail(k, 'unrecognised switch case') : -1;
        k++;
      }
      if (k >= to) return cases.length ? this.fail(j, 'unrecognised switch case') : -1;
      let v: Item;
      try { v = this.expr(j + 1, k, ctx); } catch (e) { if (cases.length) throw e; return -1; }
      cases.push([v.e, this.idx(this.ins[k + 1].target, k + 1)]);
      j = k + 2;
    }
    if (!cases.length || this.ins[j]?.op !== Op.b) return cases.length ? this.fail(j, 'switch without a final jump') : -1;
    const value = this.pop(stack, i).e;
    const d = this.idx(this.ins[j].target, j);
    let bodyFrom = j + 1;
    const labels = new Map<number, Kr[]>();
    for (const [v, t] of cases) (labels.get(t) ?? labels.set(t, []).get(t)!).push(v);
    const isEnd = (k: number) => this.ins[k]?.op === Op.popz && this.ins[k].t1 === T.Var;
    // `b D; b E` (dead) names the end E outright: then D is a default even if it starts with popz (`default: exit`).
    const dead = this.ins[bodyFrom]?.op === Op.b ? this.idx(this.ins[bodyFrom].target, bodyFrom) : -1;
    const knownEnd = dead > d && cases.every(([, t]) => dead > t) && isEnd(dead) ? dead : -1;
    if (knownEnd >= 0) bodyFrom++;
    // No default: the final jump goes straight to the end.
    const noDefault = knownEnd < 0 && isEnd(d);
    if (!noDefault) (labels.get(d) ?? labels.set(d, []).get(d)!).push(undefined);
    const sw: Switch = { labels, minEnd: Math.max(d, knownEnd, ...cases.map(([, t]) => t)), end: noDefault ? d : -1 };
    const c: Ctx = { kind: 'switch', brk: noDefault ? this.addr(d) : knownEnd >= 0 ? this.addr(knownEnd) : -1, cont: -1, sw };
    const s: Item[] = [];
    const body = this.block(bodyFrom, to, s, [...ctx, c], sw);
    if (sw.end < 0) this.fail(i, 'switch end not found');
    if (s.length) this.fail(sw.end, 'switch body leaves values on the stack');
    for (const v of labels.get(sw.end) ?? []) body.push(v === undefined ? ['ctr_default'] : ['ctr_case', v]);
    out.push(['ctr_switch', value, body]);
    return sw.end + 1;
  }

  /**
   * finally_off; catch_off; call @@try_hook@@; popz; body; b U;
   * C: pop local.e; call @@try_unhook@@; popz; catch body; call @@finish_catch@@; popz; b F;
   * U: call @@try_unhook@@; popz; F:
   * (gm_gotchas.md). Returns the next index. finally blocks fail until one is seen.
   */
  private tryStmt(i: number, to: number, stack: Item[], out: Kr[], ctx: Ctx[]): number {
    const isCall = (k: number, fn: string) => this.ins[k]?.op === Op.call && this.ins[k].fn === fn && this.ins[k + 1]?.op === Op.popz;
    this.pop(stack, i); this.pop(stack, i); // handler offsets: the layout below gives the same addresses
    if (this.ins[i + 1]?.op !== Op.popz) this.fail(i, 'try_hook result not popped');
    let c = i + 2;
    while (c < to && !(this.ins[c].op === Op.pop && this.ins[c].i16 === -7 && isCall(c + 1, '@@try_unhook@@'))) c++;
    const skip = this.ins[c - 1];
    if (c >= to || skip?.op !== Op.b) this.fail(i, 'try without a recognisable catch (try/finally is not supported yet)');
    const u = this.idx(skip.target, c - 1);
    if (!isCall(u, '@@try_unhook@@') || u > to) this.fail(c - 1, 'try body does not end at its unhook');
    const fin = u - 3; // call @@finish_catch@@; popz; b F
    if (!isCall(fin, '@@finish_catch@@') || this.ins[fin + 2].op !== Op.b || this.ins[fin + 2].target !== this.addr(u + 2)) {
      this.fail(fin, 'catch does not end at finish_catch (try/finally is not supported yet)');
    }
    const name = this.ins[c].v!.name;
    this.locals.add(name);
    out.push(['ctr_try', this.block(i + 2, c - 1, [], ctx), name, this.block(c + 3, fin, [], ctx)]);
    return u + 2;
  }

  /** inst; pushenv P; body; P: popenv body */
  private with(i: number, stack: Item[], out: Kr[], ctx: Ctx[]): number {
    const ins = this.ins[i], inst = this.popInst(stack, i);
    const e = this.idx(ins.target, i), pe = this.ins[e];
    if (!pe || pe.op !== Op.popenv || (pe.target !== this.addr(i + 1) && pe.target !== pe.at)) this.fail(i, 'with without matching popenv');
    // With a break inside: P: popenv body; b S; X: popenv (exit form); S:  and break jumps to X.
    const skip = this.ins[e + 1], x = this.ins[e + 2];
    const brkPop = skip?.op === Op.b && skip.target === this.addr(e + 3) && x?.op === Op.popenv && x.target === -1;
    out.push(['ctr_with', inst ?? ['_kw', 'self'], this.block(i + 1, e, [], [...ctx, { kind: 'with', brk: this.addr(brkPop ? e + 2 : e + 1), cont: pe.at }])]);
    return brkPop ? e + 3 : e + 1;
  }

  private assign(tgt: Kr, value: Kr): Kr {
    // x = x op y  ->  var_change (same target, read once: matches GML's compound assignment)
    if (Array.isArray(value) && value.length === 3 && CHANGE[value[0] as string] && sameTarget(value[1], tgt)) {
      return ['var_change', CHANGE[value[0] as string], tgt, value[2]];
    }
    return ['var_set', tgt, value];
  }

  private constant(v: Instr['value']): Kr {
    if (typeof v === 'bigint') {
      const n = BigInt.asIntN(64, v);
      return ['_i6', String(n)];
    }
    if (typeof v === 'number' && !Number.isFinite(v)) return ['_cn', Number.isNaN(v) ? 'NaN' : 'infinity'];
    return v;
  }

  private ext(ins: Instr, i: number, stack: Item[], out: Kr[]): void {
    switch (ins.i16) {
      case Ext.pushref: {
        if (ins.fn) { stack.push({ e: this.fnRef(ins.fn), size: 16 }); return; }
        if (typeof ins.value !== 'number') this.fail(i, 'pushref without operand');
        const kind = REF_KIND[ins.value >>> 24];
        if (!kind) this.fail(i, `pushref of unsupported asset type ${ins.value >>> 24}`);
        stack.push({ e: ['_as', this.asset(kind, ins.value & 0xffffff, i)], size: 16 });
        return;
      }
      // Copy-on-write bookkeeping: krplayer derives array owners from the variable written (see gm_gotchas.md).
      case Ext.setowner: this.pop(stack, i); return;
      case Ext.savearef: case Ext.restorearef: return;
      case Ext.chkindex: return; // pre-2.3 array index check: leaves the index on the stack
      // row index -> element. pushac is a middle dimension of a[i][j][k] (the row for the next index).
      case Ext.pushaf: case Ext.pushac: {
        const index = this.pop(stack, i).e, row = this.pop(stack, i).e;
        stack.push({ e: ['_ai', row, index], size: 16 });
        return;
      }
      case Ext.popaf: { // value row index -> row[index] = value
        const index = this.pop(stack, i).e, row = this.pop(stack, i).e, value = this.pop(stack, i).e;
        out.push(this.assign(['_ai', row, index], value));
        return;
      }
    }
    this.fail(i, `extended opcode ${ins.i16} not supported yet`);
  }

  /** A function as a value: a user function, or a built-in as its opcode (plus its ref for variant opcodes). */
  private fnRef(fn: string): Kr {
    const b = fn.startsWith(SCRIPT) || this.assets.scripts?.has(fn) || this.assets.scriptAssets?.has(fn) ? undefined : lookupBuiltin(fn);
    if (b) return b.ref === null ? ['_fn', b.op] : ['_fn', b.op, b.ref];
    return ['_fn', fnName(fn)];
  }

  private call(fn: string, args: Kr[], i: number): Kr {
    if (fn in PSEUDO) return PSEUDO[fn];
    if (this.assets.scriptAssets?.has(fn)) return ['fnc_g', GLOBAL_SCRIPT + fn, ...args];
    if (fn.startsWith(SCRIPT) || this.assets.scripts?.has(fn)) return ['fnc_g', fnName(fn), ...args];
    switch (fn) {
      case '@@NewGMLArray@@': return ['_ar', ...args];
      case '@@NewGMLObject@@': {
        const [ctor, ...rest] = args;
        const f = isOp(ctor, 'var_method') && isOp(ctor[2], '_fn') ? ctor[2][1] : isOp(ctor, '_fn') ? ctor[1] : ctor;
        return ['fnc_new', f, ...rest];
      }
      // static f = function(){}: bound to the static scope (-16), which acts as unbound: self is the caller (gm_gotchas.md)
      case 'method': return args[0] === -16 ? args[1] : ['var_method', ...args];
      case '@@GetInstance@@': return args[0]; // obj.method(): the object stands for its instance
    }
    const b = lookupBuiltin(fn);
    if (b) return b.ref === null ? [b.op, ...args] : [b.op, b.ref, ...args];
    this.fail(i, `unknown function ${fn}`);
  }
}

/** Function key in krpj: the GM function name without the gml_Script_ prefix. */
/** 2.3+ script assets' code entries (their global body), also the krpj function running that body again. */
export const GLOBAL_SCRIPT = 'gml_GlobalScript_';
export const fnName = (fn: string) => (fn.startsWith(SCRIPT) ? fn.slice(SCRIPT.length) : fn);

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
