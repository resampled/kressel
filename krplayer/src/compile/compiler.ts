// Script tree -> flat bytecode (see bytecode.ts). Names become slots, opcode names become ids.
// Unknown or unimplemented opcodes fail here, at load time, with their location.

import type { Node, Script } from '../krpj.ts';
import { opcodeId } from '../opcodes.ts';
import { IMPL } from '../builtins/registry.ts';
import { BinOp, Op, S, UnOp, type Block } from './bytecode.ts';
import { GV_NAMES, GV_READONLY, IV_NAMES, IV_READONLY } from './names.ts';

export class CompileError extends Error {}

export interface CompileEnv {
  /** Index of an asset (within its kind) by name. */
  asset(name: string): number | undefined;
  /** Slot for a user variable name (instance, struct or global), allocated on first use. */
  userVar(name: string): number;
  /** Index of a user function by key. */
  func(name: string): number | undefined;
  /** The value of a function reference (`_fn`): its script index, or a method; undefined if there's no such function. A built-in opcode (with its ref) gives a function that forwards to it. */
  fnValue(name: string, ref?: string): unknown;
  /** A fresh range of n copy-on-write owner tokens (for a block's locals). */
  owners(n: number): number;
}

const BIN: Record<string, number> = {
  opr_add: BinOp.add, opr_sub: BinOp.sub, opr_mul: BinOp.mul, opr_div: BinOp.div, opr_idiv: BinOp.idiv, opr_mod: BinOp.mod,
  opr_eq: BinOp.eq, opr_neq: BinOp.neq, opr_lt: BinOp.lt, opr_lte: BinOp.lte, opr_gt: BinOp.gt, opr_gte: BinOp.gte,
  opr_xor: BinOp.xor, opr_band: BinOp.band, opr_bor: BinOp.bor, opr_bxor: BinOp.bxor, opr_shl: BinOp.shl, opr_shr: BinOp.shr,
};
const UN: Record<string, number> = { opr_neg: UnOp.neg, opr_not: UnOp.not, opr_bnot: UnOp.bnot };
const CHANGE: Record<string, number> = { '+': BinOp.add, '-': BinOp.sub, '*': BinOp.mul, '/': BinOp.div, '%': BinOp.mod, '&': BinOp.band, '|': BinOp.bor, '^': BinOp.bxor, '<<': BinOp.shl, '>>': BinOp.shr };
const KW: Record<string, number> = { all: -3, noone: -4, global: -5 };
const CONSTS: Record<string, unknown> = { infinity: Infinity, NaN: NaN, ptr_null: 0, ptr_invalid: -1 };
/** argumentN / argument_count / argument. */
const ARG_N = /^argument(\d|1[0-5])$/;

/**
 * Copy-on-write owner tokens: an array written through a variable that doesn't own it is copied first
 * (GM's setowner, which is per variable rather than per instance; see gm_gotchas.md).
 */
const OWN_INST = 1 << 24, OWN_GLOBAL = 2 << 24, OWN_ARG = 3 << 24, OWN_LOCAL = 4 << 24;

/**
 * A resolved variable target: scope + id, plus the instance/index expressions to evaluate.
 * `rows` are the leading indices of a multi-dimensional access (a[i][j]: rows [i], index j).
 */
interface Ref { scope: number; id: number; inst: Node | undefined; index: Node | undefined; rows: Node[]; ro: boolean; own: number }
interface Ctx { kind: 'loop' | 'with' | 'switch' | 'try'; breaks: number[]; conts: number[] }

const isOp = (n: Node): n is [string, ...Node[]] => Array.isArray(n) && typeof n[0] === 'string';

export function compileScript(body: Script, name: string, env: CompileEnv, params: string[] = []): Block {
  return new Compiler(name, env).run(body, params);
}

class Compiler {
  private code: number[] = [];
  private consts: unknown[] = [];
  private constIdx = new Map<unknown, number>();
  private locals = new Map<string, number>();
  /** `static` names declared in this body. */
  private statics = new Set<string>();
  private nLocals = 0;
  private localOwn = 0;
  private ctx: Ctx[] = [];
  private stmtPc: number[] = [];
  private stmtPath: string[] = [];
  private readonly name: string;
  private readonly env: CompileEnv;

  constructor(name: string, env: CompileEnv) { this.name = name; this.env = env; }

  run(body: Script, params: string[]): Block {
    // Named parameters are locals initialised from the arguments.
    for (const p of params) if (!this.locals.has(p)) this.locals.set(p, this.nLocals++);
    this.hoistLocals(body);
    this.localOwn = this.env.owners(Math.max(1, this.nLocals));
    params.forEach((p, k) => { this.emit(Op.GET, S.ARG, k); this.emit(Op.SET, S.LOCAL, this.locals.get(p)!, this.localOwn + this.locals.get(p)!); });
    this.script(body, '');
    this.emit(Op.EXIT);
    return { code: Int32Array.from(this.code), consts: this.consts, nLocals: this.nLocals, name: this.name, stmtPc: this.stmtPc, stmtPath: this.stmtPath, localNames: this.localNames() };
  }

  private localNames(): string[] { const r: string[] = []; for (const [k, i] of this.locals) r[i] = k; return r; }

  private fail(path: string, msg: string): never { throw new CompileError(`${this.name}${path}: ${msg}`); }

  /** `var` is function-scoped in GML: every var_local in the body gets a slot up front. */
  private hoistLocals(n: Node): void {
    if (!Array.isArray(n)) return;
    if (n[0] === 'fnc_def') return;
    if (n[0] === 'var_local' && typeof n[1] === 'string' && !this.locals.has(n[1])) this.locals.set(n[1], this.nLocals++);
    if (n[0] === 'var_static' && typeof n[1] === 'string') this.statics.add(n[1]);
    if (n[0] === 'ctr_try' && typeof n[2] === 'string' && !this.locals.has(n[2])) this.locals.set(n[2], this.nLocals++); // catch (e)
    for (const c of n) this.hoistLocals(c);
  }
  private temp(): number { return this.nLocals++; }

  private emit(...xs: number[]): number { const at = this.code.length; this.code.push(...xs); return at; }
  /** Emits op with a placeholder target; returns the operand index to patch. */
  private jump(op: number): number { this.code.push(op, -1); return this.code.length - 1; }
  private patch(at: number | number[], to = this.code.length): void {
    for (const a of Array.isArray(at) ? at : [at]) this.code[a] = to;
  }
  private konst(v: unknown): void {
    let k = this.constIdx.get(v);
    if (k === undefined || Number.isNaN(v)) { k = this.consts.length; this.consts.push(v); this.constIdx.set(v, k); }
    this.emit(Op.CONST, k);
  }

  private script(s: Node, path: string): void {
    if (!Array.isArray(s)) this.fail(path, 'expected a script (statement list)');
    s.forEach((st, i) => this.stmt(st, `${path}/${i}`));
  }

  // ---------------------------------------------------------------- variables

  private simple(scope: number, id: number, ro: boolean, own: number, inst?: Node): Ref {
    return { scope, id, inst, index: undefined, rows: [], ro, own };
  }

  private ref(n: Node, path: string): Ref {
    if (!isOp(n)) this.fail(path, 'expected a variable');
    const [head, a, b] = n;
    if (head === '_ai') {
      const base = this.ref(a, path);
      if (base.index === undefined) return { ...base, index: b };
      return { ...base, rows: [...base.rows, base.index], index: b };
    }
    if (head === '_lv') {
      if (typeof a !== 'string') this.fail(path, '_lv needs a name');
      const local = this.locals.get(a);
      if (local !== undefined) return this.simple(S.LOCAL, local, false, this.localOwn + local);
      if (this.statics.has(a)) { const v = this.env.userVar(a); return this.simple(S.STATIC, v, false, OWN_INST + v); }
      const arg = ARG_N.exec(a);
      if (arg) return this.simple(S.ARG, Number(arg[1]), false, OWN_ARG + Number(arg[1]));
      if (a === 'argument') return this.simple(S.ARG, -1, false, OWN_ARG + 16);
      if (a === 'argument_count') return this.simple(S.ARG, -2, true, 0);
      const iv = IV_NAMES.get(a);
      if (iv !== undefined) return this.simple(S.BSELF, iv, IV_READONLY.has(iv), 0);
      const gv = GV_NAMES.get(a);
      if (gv !== undefined) return this.simple(S.BGLOBAL, gv, GV_READONLY.has(gv), 0);
      const v = this.env.userVar(a);
      return this.simple(S.SELF, v, false, OWN_INST + v);
    }
    if (head === '_iv') {
      if (typeof b !== 'string') this.fail(path, '_iv needs a name');
      const kw = isOp(a) && a[0] === '_kw' ? a[1] : null;
      if (kw === 'global') { const v = this.env.userVar(b); return this.simple(S.GLOBAL, v, false, OWN_GLOBAL + v); }
      const iv = IV_NAMES.get(b);
      if (kw === 'self') return iv !== undefined ? this.simple(S.BSELF, iv, IV_READONLY.has(iv), 0) : this.ref(['_lv', b], path);
      if (iv !== undefined) return this.simple(S.BFIELD, iv, IV_READONLY.has(iv), 0, a);
      const v = this.env.userVar(b);
      return this.simple(S.FIELD, v, false, OWN_INST + v, a);
    }
    this.fail(path, `${head} is not assignable`);
  }

  /** Pushes the instance and first index of a ref; returns how many. */
  private operands(r: Ref, path: string): number {
    let k = 0;
    if (r.inst !== undefined) { this.expr(r.inst, path); k++; }
    const first = r.rows.length ? r.rows[0] : r.index;
    if (first !== undefined) { this.expr(first, path); k++; }
    return k;
  }
  /** Reads a ref (operands already pushed). */
  private get(r: Ref, path: string): void {
    if (r.index === undefined) { this.emit(Op.GET, r.scope, r.id); return; }
    this.emit(Op.GETI, r.scope, r.id);
    if (!r.rows.length) return;
    for (const ix of [...r.rows.slice(1), r.index]) { this.expr(ix, path); this.emit(Op.AGET); }
  }
  /** Pushes the innermost row of a multi-dimensional ref, ready for its final index. */
  private row(r: Ref, path: string): void {
    this.operands(r, path);
    this.emit(Op.AROWV, r.scope, r.id, r.own);
    for (const ix of r.rows.slice(1)) { this.expr(ix, path); this.emit(Op.AROW, r.own); }
  }
  private assignTo(r: Ref, path: string): void {
    if (r.ro) this.fail(path, 'variable is read-only');
    if (r.rows.length) { this.row(r, path); this.expr(r.index, path); this.emit(Op.ASET, r.own); return; }
    this.operands(r, path);
    this.emit(r.index !== undefined ? Op.SETI : Op.SET, r.scope, r.id, r.own);
  }

  /** target op= value (target evaluated once). With `result`, leaves the new (or, postfix, old) value. */
  private change(op: number, target: Node, value: Node | null, path: string, result: 'none' | 'new' | 'old' = 'none'): void {
    const r = this.ref(target, path);
    if (r.ro) this.fail(path, 'variable is read-only');
    const k = r.rows.length ? 2 : this.operands(r, path);
    if (r.rows.length) { this.row(r, path); this.expr(r.index, path); this.emit(Op.DUP, 2, Op.AGET); }
    else { if (k) this.emit(Op.DUP, k); this.get({ ...r, rows: [] }, path); }
    if (result === 'old') this.emit(Op.DUP, 1, Op.SINK, k + 1);
    if (value === null) this.konst(1); else this.expr(value, path);
    this.emit(Op.BIN, op);
    if (result === 'new') this.emit(Op.DUP, 1, Op.SINK, k + 1);
    if (k) this.emit(Op.SINK, k);
    if (r.rows.length) this.emit(Op.ASET, r.own);
    else this.emit(r.index !== undefined ? Op.SETI : Op.SET, r.scope, r.id, r.own);
  }

  // ---------------------------------------------------------------- statements

  private stmt(n: Node, path: string): void {
    if (!isOp(n)) this.fail(path, 'a plain value is not a statement');
    this.stmtPc.push(this.code.length); this.stmtPath.push(path);
    const [head, a, b, c, d] = n;
    switch (head) {
      case 'var_set': {
        this.expr(b, path); // GM evaluates the value before the target
        return this.assignTo(this.ref(a, path), path);
      }
      case 'var_change': {
        const op = typeof a === 'string' ? CHANGE[a] : undefined;
        if (op === undefined) this.fail(path, `var_change operator ${JSON.stringify(a)} not supported`);
        return this.change(op, b, c, path);
      }
      case 'var_inc': case 'var_dec': return this.change(head === 'var_inc' ? BinOp.add : BinOp.sub, a, null, path);
      case 'var_local': {
        if (typeof a !== 'string') this.fail(path, 'var_local needs a name');
        if (n.length <= 2) return; // a declaration only: GM leaves the slot unset
        this.expr(b, path);
        const l = this.locals.get(a)!;
        this.emit(Op.SET, S.LOCAL, l, this.localOwn + l);
        return;
      }
      case 'var_static': { // initialised the first time the function reaches it
        if (typeof a !== 'string') this.fail(path, 'var_static needs a name');
        const v = this.env.userVar(a);
        this.emit(Op.SHAS, v);
        const jt = this.jump(Op.JT);
        this.expr(b, path);
        this.emit(Op.SET, S.STATIC, v, OWN_INST + v);
        return this.patch(jt);
      }
      case 'ctr_if': {
        this.expr(a, path);
        const jf = this.jump(Op.JF);
        this.script(b, `${path}/then`);
        if (c === undefined || c === null) return this.patch(jf);
        const jend = this.jump(Op.JMP);
        this.patch(jf);
        this.script(c, `${path}/else`);
        return this.patch(jend);
      }
      case 'ctr_while': {
        const top = this.code.length;
        this.expr(a, path);
        const jf = this.jump(Op.JF);
        const ctx = this.loop('loop', () => this.script(b, `${path}/body`));
        this.emit(Op.JMP, top);
        this.patch(ctx.conts, top); this.patch([jf, ...ctx.breaks]);
        return;
      }
      case 'ctr_do_until': {
        const top = this.code.length;
        const ctx = this.loop('loop', () => this.script(a, `${path}/body`));
        this.patch(ctx.conts);
        this.expr(b, path);
        this.emit(Op.JF, top);
        return this.patch(ctx.breaks);
      }
      case 'ctr_for': {
        this.script(a, `${path}/init`);
        const top = this.code.length;
        this.expr(b, path);
        const jf = this.jump(Op.JF);
        const ctx = this.loop('loop', () => this.script(d, `${path}/body`));
        this.patch(ctx.conts);
        this.script(c, `${path}/step`);
        this.emit(Op.JMP, top);
        return this.patch([jf, ...ctx.breaks]);
      }
      case 'ctr_repeat': {
        const t = this.temp();
        this.expr(a, path);
        this.emit(Op.SET, S.LOCAL, t, 0);
        const top = this.code.length;
        this.emit(Op.GET, S.LOCAL, t); this.konst(0); this.emit(Op.BIN, BinOp.gt);
        const jf = this.jump(Op.JF);
        this.emit(Op.GET, S.LOCAL, t); this.konst(1); this.emit(Op.BIN, BinOp.sub, Op.SET, S.LOCAL, t, 0);
        const ctx = this.loop('loop', () => this.script(b, `${path}/body`));
        this.emit(Op.JMP, top);
        this.patch(ctx.conts, top); this.patch([jf, ...ctx.breaks]);
        return;
      }
      case 'ctr_switch': return this.switchStmt(a, b, path);
      case 'ctr_with': {
        this.expr(a, path);
        const jend = this.jump(Op.WITH_BEGIN);
        const body = this.code.length;
        const ctx = this.loop('with', () => this.script(b, `${path}/body`));
        this.patch(ctx.conts);
        this.emit(Op.WITH_NEXT, body);
        return this.patch([jend, ...ctx.breaks]);
      }
      case 'ctr_break': case 'ctr_continue': {
        const brk = head === 'ctr_break';
        let i = this.ctx.length - 1;
        // Leaving a try drops its handler; continue also passes through switches.
        for (; i >= 0 && (this.ctx[i].kind === 'try' || (!brk && this.ctx[i].kind === 'switch')); i--) if (this.ctx[i].kind === 'try') this.emit(Op.TRY_END);
        const ctx = this.ctx[i];
        if (!ctx) this.fail(path, `${head} outside a loop`);
        if (brk && ctx.kind === 'with') this.emit(Op.WITH_EXIT);
        (brk ? ctx.breaks : ctx.conts).push(this.jump(Op.JMP));
        return;
      }
      case 'ctr_try': {
        if (Array.isArray(d) && d.length) this.fail(path, 'ctr_try finally blocks are not implemented in krplayer yet');
        const jcatch = this.jump(Op.TRY_BEGIN);
        this.loop('try', () => this.script(a, `${path}/try`));
        this.emit(Op.TRY_END);
        const jend = this.jump(Op.JMP);
        this.patch(jcatch);
        // The VM pushes the exception: store it in the catch variable, or drop it.
        if (typeof b === 'string') { const l = this.locals.get(b)!; this.emit(Op.SET, S.LOCAL, l, this.localOwn + l); }
        else this.emit(Op.POP);
        if (Array.isArray(c)) this.script(c, `${path}/catch`);
        return this.patch(jend);
      }
      case 'ctr_exit': this.emit(Op.EXIT); return;
      case 'ctr_return':
        if (n.length > 1) this.expr(a, path); else this.konst(undefined);
        this.emit(Op.RET);
        return;
      case 'ctr_case': case 'ctr_default': this.fail(path, `${head} outside ctr_switch`);
    }
    this.expr(n, path);
    this.emit(Op.POP);
  }

  private loop(kind: Ctx['kind'], body: () => void): Ctx {
    const ctx: Ctx = { kind, breaks: [], conts: [] };
    this.ctx.push(ctx);
    body();
    this.ctx.pop();
    return ctx;
  }

  private switchStmt(value: Node, body: Node, path: string): void {
    if (!Array.isArray(body)) this.fail(path, 'ctr_switch needs a body');
    const t = this.temp();
    this.expr(value, path);
    this.emit(Op.SET, S.LOCAL, t, 0);
    const caseJumps = new Map<number, number>();
    let defaultAt = -1;
    body.forEach((st, i) => {
      if (isOp(st) && st[0] === 'ctr_case') {
        this.emit(Op.GET, S.LOCAL, t);
        this.expr(st[1], `${path}/${i}`);
        this.emit(Op.BIN, BinOp.eq);
        caseJumps.set(i, this.jump(Op.JT));
      } else if (isOp(st) && st[0] === 'ctr_default') defaultAt = i;
    });
    const jdefault = this.jump(Op.JMP);
    const ctx = this.loop('switch', () => body.forEach((st, i) => {
      if (isOp(st) && (st[0] === 'ctr_case' || st[0] === 'ctr_default')) {
        if (caseJumps.has(i)) this.patch(caseJumps.get(i)!);
        if (i === defaultAt) this.patch(jdefault);
        return;
      }
      this.stmt(st, `${path}/${i}`);
    }));
    if (defaultAt < 0) this.patch(jdefault);
    this.patch(ctx.breaks);
  }

  // ---------------------------------------------------------------- expressions

  /** Arguments right to left, like GM; returns how many. */
  private args(n: Node[], from: number, path: string): number {
    for (let i = n.length - 1; i >= from; i--) this.expr(n[i], `${path}/${i}`);
    return n.length - from;
  }

  private expr(n: Node | undefined, path: string): void {
    if (n === undefined) this.fail(path, 'missing argument');
    if (n === null) return this.konst(undefined);
    if (typeof n === 'number' || typeof n === 'string' || typeof n === 'boolean') return this.konst(n);
    if (!Array.isArray(n)) this.fail(path, 'struct literals not supported yet');
    const [head, a, b, c] = n;
    if (typeof head !== 'string') this.fail(path, 'opcode array must start with a name');
    switch (head) {
      case '_lv': case '_iv': case '_ai': {
        if (head === '_lv' && a === 'undefined') return this.konst(undefined);
        const r = this.ref(n, path);
        this.operands(r, path);
        return this.get(r, path);
      }
      case '_kw':
        if (a === 'self') { this.emit(Op.SELFID); return; }
        if (a === 'other') { this.emit(Op.OTHERID); return; }
        if (typeof a === 'string' && a in KW) return this.konst(KW[a]);
        this.fail(path, `unknown keyword ${JSON.stringify(a)}`);
      case '_as': {
        const i = typeof a === 'string' ? this.env.asset(a) : undefined;
        if (i === undefined) this.fail(path, `unknown asset ${JSON.stringify(a)}`);
        return this.konst(i);
      }
      case '_fn': {
        const v = typeof a === 'string' ? this.env.fnValue(a, typeof b === 'string' ? b : undefined) : undefined;
        if (v === undefined) this.fail(path, `unknown function ${JSON.stringify(a)}`);
        return this.konst(v);
      }
      case '_cn':
        if (typeof a === 'string' && a in CONSTS) return this.konst(CONSTS[a]);
        this.fail(path, `constant ${JSON.stringify(a)} not supported`);
      case '_i6': {
        // int64 is not modelled yet: the literal becomes a real (exact up to 2^53).
        const v = typeof a === 'string' ? Number(a) : NaN;
        if (Number.isNaN(v)) this.fail(path, '_i6 needs an integer string');
        return this.konst(v);
      }
      case '_ar': {
        const k = this.args(n, 1, path);
        this.emit(Op.ARRAY, k);
        return;
      }
      case 'opr_and': case 'opr_or': {
        this.expr(a, path);
        const j = this.jump(head === 'opr_and' ? Op.JF : Op.JT);
        this.expr(b, path);
        this.emit(Op.BOOL);
        const jend = this.jump(Op.JMP);
        this.patch(j);
        this.konst(head === 'opr_or');
        return this.patch(jend);
      }
      case 'opr_cond': {
        this.expr(a, path);
        const jf = this.jump(Op.JF);
        this.expr(b, path);
        const jend = this.jump(Op.JMP);
        this.patch(jf);
        this.expr(c, path);
        return this.patch(jend);
      }
      case 'var_inc': case 'var_dec':
        return this.change(head === 'var_inc' ? BinOp.add : BinOp.sub, a, null, path, b === true ? 'old' : 'new');
      case 'fnc_g': {
        const f = typeof a === 'string' ? this.env.func(a) : undefined;
        if (f === undefined) this.fail(path, `unknown function ${JSON.stringify(a)}`);
        this.emit(Op.CALLF, f, this.args(n, 2, path));
        return;
      }
      case 'fnc_m': {
        const k = this.args(n, 2, path);
        const iv = isOp(a) && a[0] === '_iv' ? a : null, on = iv ? iv[1] : null;
        if (iv && !(isOp(on!) && on[0] === '_kw' && (on[1] === 'self' || on[1] === 'global'))) {
          // inst.method(...): inst is the call's self (unless the method is bound)
          const name = iv[2];
          if (typeof name !== 'string' || IV_NAMES.has(name)) this.fail(path, 'fnc_m needs a user variable');
          this.expr(on, path);
          this.emit(Op.DUP, 1);
          this.emit(Op.GET, S.FIELD, this.env.userVar(name));
        } else {
          this.emit(Op.SELFID);
          this.expr(a, path);
        }
        this.emit(Op.CALLV, k);
        return;
      }
      case 'ctr_script_execute': {
        const k = this.args(n, 2, path);
        this.emit(Op.SELFID);
        this.expr(a, path);
        this.emit(Op.CALLV, k);
        return;
      }
      case 'fnc_new': {
        const k = this.args(n, 2, path);
        if (typeof a === 'string') {
          const f = this.env.func(a);
          if (f === undefined) this.fail(path, `unknown constructor ${JSON.stringify(a)}`);
          this.emit(Op.NEW, f, k);
        } else { this.expr(a, path); this.emit(Op.NEWV, k); }
        return;
      }
    }
    if (head in BIN) { this.expr(a, path); this.expr(b, path); this.emit(Op.BIN, BIN[head]); return; }
    if (head in UN) { this.expr(a, path); this.emit(Op.UN, UN[head]); return; }
    // Control blocks aren't values, but ctr_ function opcodes with a builtin (game_get_speed...) are.
    const known = (() => { try { return opcodeId(head, ''); } catch { return -1; } })();
    if (head.startsWith('_') || (head.startsWith('ctr_') && !IMPL[known]) || head.startsWith('evt_') || head.startsWith('var_local')) {
      this.fail(path, `${head} is not supported as an expression`);
    }
    let id: number;
    try { id = opcodeId(head, `${this.name}${path}`); } catch (e) { throw new CompileError((e as Error).message); }
    if (!IMPL[id]) this.fail(path, `opcode ${head} is not implemented in krplayer yet`);
    this.emit(Op.CALL, id, this.args(n, 1, path));
  }
}
