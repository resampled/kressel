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
  /** Slot for a user variable name (instance or global), allocated on first use. */
  userVar(name: string): number;
}

const BIN: Record<string, number> = {
  opr_add: BinOp.add, opr_sub: BinOp.sub, opr_mul: BinOp.mul, opr_div: BinOp.div, opr_idiv: BinOp.idiv, opr_mod: BinOp.mod,
  opr_eq: BinOp.eq, opr_neq: BinOp.neq, opr_lt: BinOp.lt, opr_lte: BinOp.lte, opr_gt: BinOp.gt, opr_gte: BinOp.gte,
  opr_xor: BinOp.xor, opr_band: BinOp.band, opr_bor: BinOp.bor, opr_bxor: BinOp.bxor, opr_shl: BinOp.shl, opr_shr: BinOp.shr,
};
const UN: Record<string, number> = { opr_neg: UnOp.neg, opr_not: UnOp.not, opr_bnot: UnOp.bnot };
const CHANGE: Record<string, number> = { '+': BinOp.add, '-': BinOp.sub, '*': BinOp.mul, '/': BinOp.div, '%': BinOp.mod, '&': BinOp.band, '|': BinOp.bor, '^': BinOp.bxor, '<<': BinOp.shl, '>>': BinOp.shr };
const KW: Record<string, number> = { all: -3, noone: -4, global: -5 };

/** A resolved variable target: scope + id, plus the instance/index expressions to evaluate. */
interface Ref { scope: number; id: number; inst: Node | undefined; index: Node | undefined; ro: boolean }
interface Ctx { kind: 'loop' | 'with' | 'switch'; breaks: number[]; conts: number[] }

const isOp = (n: Node): n is [string, ...Node[]] => Array.isArray(n) && typeof n[0] === 'string';

export function compileScript(body: Script, name: string, env: CompileEnv): Block {
  return new Compiler(name, env).run(body);
}

class Compiler {
  private code: number[] = [];
  private consts: unknown[] = [];
  private constIdx = new Map<unknown, number>();
  private locals = new Map<string, number>();
  private nLocals = 0;
  private ctx: Ctx[] = [];
  private stmtPc: number[] = [];
  private stmtPath: string[] = [];
  private readonly name: string;
  private readonly env: CompileEnv;

  constructor(name: string, env: CompileEnv) { this.name = name; this.env = env; }

  run(body: Script): Block {
    this.hoistLocals(body);
    this.script(body, '');
    this.emit(Op.EXIT);
    return { code: Int32Array.from(this.code), consts: this.consts, nLocals: this.nLocals, name: this.name, stmtPc: this.stmtPc, stmtPath: this.stmtPath };
  }

  private fail(path: string, msg: string): never { throw new CompileError(`${this.name}${path}: ${msg}`); }

  /** `var` is function-scoped in GML: every var_local in the body gets a slot up front. */
  private hoistLocals(n: Node): void {
    if (!Array.isArray(n)) return;
    if (n[0] === 'fnc_def') return;
    if (n[0] === 'var_local' && typeof n[1] === 'string' && !this.locals.has(n[1])) this.locals.set(n[1], this.nLocals++);
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
    if (k === undefined) { k = this.consts.length; this.consts.push(v); this.constIdx.set(v, k); }
    this.emit(Op.CONST, k);
  }

  private script(s: Node, path: string): void {
    if (!Array.isArray(s)) this.fail(path, 'expected a script (statement list)');
    s.forEach((st, i) => this.stmt(st, `${path}/${i}`));
  }

  // ---------------------------------------------------------------- variables

  private ref(n: Node, path: string): Ref {
    if (!isOp(n)) this.fail(path, 'expected a variable');
    const [head, a, b] = n;
    if (head === '_ai') {
      const base = this.ref(a, path);
      if (base.index !== undefined) this.fail(path, 'multi-dimensional arrays not supported yet');
      return { ...base, index: b };
    }
    if (head === '_lv') {
      if (typeof a !== 'string') this.fail(path, '_lv needs a name');
      const local = this.locals.get(a);
      if (local !== undefined) return { scope: S.LOCAL, id: local, inst: undefined, index: undefined, ro: false };
      const iv = IV_NAMES.get(a);
      if (iv !== undefined) return { scope: S.BSELF, id: iv, inst: undefined, index: undefined, ro: IV_READONLY.has(iv) };
      const gv = GV_NAMES.get(a);
      if (gv !== undefined) return { scope: S.BGLOBAL, id: gv, inst: undefined, index: undefined, ro: GV_READONLY.has(gv) };
      return { scope: S.SELF, id: this.env.userVar(a), inst: undefined, index: undefined, ro: false };
    }
    if (head === '_iv') {
      if (typeof b !== 'string') this.fail(path, '_iv needs a name');
      const kw = isOp(a) && a[0] === '_kw' ? a[1] : null;
      if (kw === 'global') return { scope: S.GLOBAL, id: this.env.userVar(b), inst: undefined, index: undefined, ro: false };
      const iv = IV_NAMES.get(b);
      if (kw === 'self') {
        return iv !== undefined ? { scope: S.BSELF, id: iv, inst: undefined, index: undefined, ro: IV_READONLY.has(iv) }
          : { scope: S.SELF, id: this.env.userVar(b), inst: undefined, index: undefined, ro: false };
      }
      return iv !== undefined ? { scope: S.BFIELD, id: iv, inst: a, index: undefined, ro: IV_READONLY.has(iv) }
        : { scope: S.FIELD, id: this.env.userVar(b), inst: a, index: undefined, ro: false };
    }
    this.fail(path, `${head} is not assignable`);
  }
  /** Pushes the instance/index operands of a ref; returns how many. */
  private operands(r: Ref, path: string): number {
    let k = 0;
    if (r.inst !== undefined) { this.expr(r.inst, path); k++; }
    if (r.index !== undefined) { this.expr(r.index, path); k++; }
    return k;
  }
  private get(r: Ref): void { this.emit(r.index !== undefined ? Op.GETI : Op.GET, r.scope, r.id); }
  private set(r: Ref, path: string): void {
    if (r.ro) this.fail(path, 'variable is read-only');
    this.emit(r.index !== undefined ? Op.SETI : Op.SET, r.scope, r.id);
  }

  /** target op= value (target evaluated once). With `result`, leaves the new (or, postfix, old) value. */
  private change(op: number, target: Node, value: Node | null, path: string, result: 'none' | 'new' | 'old' = 'none'): void {
    const r = this.ref(target, path);
    const k = this.operands(r, path);
    if (k) this.emit(Op.DUP, k);
    this.get(r);
    if (result === 'old') this.emit(Op.DUP, 1, Op.SINK, k + 1);
    if (value === null) this.konst(1); else this.expr(value, path);
    this.emit(Op.BIN, op);
    if (result === 'new') this.emit(Op.DUP, 1, Op.SINK, k + 1);
    if (k) this.emit(Op.SINK, k);
    this.set(r, path);
  }

  // ---------------------------------------------------------------- statements

  private stmt(n: Node, path: string): void {
    if (!isOp(n)) this.fail(path, 'a plain value is not a statement');
    this.stmtPc.push(this.code.length); this.stmtPath.push(path);
    const [head, a, b, c, d] = n;
    switch (head) {
      case 'var_set': {
        this.expr(b, path); // GM evaluates the value before the target
        const r = this.ref(a, path);
        this.operands(r, path);
        this.set(r, path);
        return;
      }
      case 'var_change': {
        const op = typeof a === 'string' ? CHANGE[a] : undefined;
        if (op === undefined) this.fail(path, `var_change operator ${JSON.stringify(a)} not supported`);
        return this.change(op, b, c, path);
      }
      case 'var_inc': case 'var_dec': return this.change(head === 'var_inc' ? BinOp.add : BinOp.sub, a, null, path);
      case 'var_local': {
        if (typeof a !== 'string') this.fail(path, 'var_local needs a name');
        if (n.length > 2) this.expr(b, path); else this.konst(undefined);
        this.emit(Op.SET, S.LOCAL, this.locals.get(a)!);
        return;
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
        this.emit(Op.SET, S.LOCAL, t);
        const top = this.code.length;
        this.emit(Op.GET, S.LOCAL, t); this.konst(0); this.emit(Op.BIN, BinOp.gt);
        const jf = this.jump(Op.JF);
        this.emit(Op.GET, S.LOCAL, t); this.konst(1); this.emit(Op.BIN, BinOp.sub, Op.SET, S.LOCAL, t);
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
        if (!brk) while (i >= 0 && this.ctx[i].kind === 'switch') i--;
        const ctx = this.ctx[i];
        if (!ctx) this.fail(path, `${head} outside a loop`);
        if (brk && ctx.kind === 'with') this.emit(Op.WITH_EXIT);
        (brk ? ctx.breaks : ctx.conts).push(this.jump(Op.JMP));
        return;
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
    this.emit(Op.SET, S.LOCAL, t);
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

  private expr(n: Node | undefined, path: string): void {
    if (n === undefined) this.fail(path, 'missing argument');
    if (n === null) return this.konst(undefined);
    if (typeof n === 'number' || typeof n === 'string' || typeof n === 'boolean') return this.konst(n);
    if (!Array.isArray(n)) this.fail(path, 'struct literals not supported yet');
    const [head, a, b, c] = n;
    if (typeof head !== 'string') this.fail(path, 'opcode array must start with a name');
    switch (head) {
      case '_lv': case '_iv': case '_ai': {
        const r = this.ref(n, path);
        this.operands(r, path);
        return this.get(r);
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
      case '_cn':
        if (a === 'infinity') return this.konst(Infinity);
        if (a === 'NaN') return this.konst(NaN);
        this.fail(path, `constant ${JSON.stringify(a)} not supported yet`);
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
    }
    if (head in BIN) { this.expr(a, path); this.expr(b, path); this.emit(Op.BIN, BIN[head]); return; }
    if (head in UN) { this.expr(a, path); this.emit(Op.UN, UN[head]); return; }
    if (head.startsWith('_') || head.startsWith('ctr_') || head.startsWith('evt_') || head.startsWith('var_local')) {
      this.fail(path, `${head} is not supported as an expression`);
    }
    let id: number;
    try { id = opcodeId(head, `${this.name}${path}`); } catch (e) { throw new CompileError((e as Error).message); }
    if (!IMPL[id]) this.fail(path, `opcode ${head} is not implemented in krplayer yet`);
    for (let i = n.length - 1; i >= 1; i--) this.expr(n[i], `${path}/${i}`); // right to left, like GM
    this.emit(Op.CALL, id, n.length - 1);
  }
}
