// The bytecode interpreter. Switch dispatch over a flat Int32Array; the value stack, locals and
// `with` frames are preallocated, so running a block allocates nothing (except GML arrays/strings).

import { BinOp, Op, S, UnOp, type Block } from '../compile/bytecode.ts';
import { IMPL } from '../builtins/registry.ts';
import { add, bits, compare, equals, fromBits, GmlError, idiv, mod, real, truthy, type Value } from '../value.ts';
import { Instance, NOI, UNSET } from '../runtime/instance.ts';
import type { Game } from '../runtime/game.ts';

const STACK = 8192, LOCALS = 1 << 16, WITH_DEPTH = 256;

/** A runtime error already annotated with its script location. */
export class RuntimeError extends Error {}

export class VM {
  readonly stack: Value[] = new Array(STACK).fill(undefined);
  sp = 0;
  private readonly locals: Value[] = new Array(LOCALS).fill(undefined);
  private lp = 0;
  private readonly wList: Instance[][] = Array.from({ length: WITH_DEPTH }, () => []);
  private readonly wIdx = new Int32Array(WITH_DEPTH);
  private readonly wSelf: (Instance | null)[] = new Array(WITH_DEPTH).fill(null);
  private readonly wOther: (Instance | null)[] = new Array(WITH_DEPTH).fill(null);
  private wsp = 0;
  private readonly g: Game;

  constructor(g: Game) { this.g = g; }

  /** Runs a block as self (with other). Returns its ctr_return value. */
  run(b: Block, self: Instance, other: Instance | null): Value {
    const g = this.g, code = b.code, consts = b.consts as Value[], s = this.stack, L = this.locals;
    const savedSelf = g.self, savedOther = g.other, sp0 = this.sp, lp = this.lp, w0 = this.wsp;
    if (lp + b.nLocals > LOCALS) throw new RuntimeError(`${b.name}: out of local variable space (recursion too deep?)`);
    for (let i = 0; i < b.nLocals; i++) L[lp + i] = undefined;
    this.lp += b.nLocals;
    g.self = self; g.other = other;
    let sp = sp0, pc = 0, result: Value = undefined;
    try {
      for (;;) {
        if (sp > STACK - 64) throw new GmlError('value stack overflow');
        switch (code[pc]) {
          case Op.CONST: s[sp++] = consts[code[pc + 1]]; pc += 2; break;
          case Op.GET: {
            const scope = code[pc + 1], id = code[pc + 2];
            if (scope === S.LOCAL) s[sp++] = L[lp + id];
            else if (scope === S.FIELD || scope === S.BFIELD) s[sp - 1] = this.getField(s[sp - 1], scope, id);
            else s[sp++] = this.getVar(scope, id, g.self);
            pc += 3; break;
          }
          case Op.SET: {
            const scope = code[pc + 1], id = code[pc + 2];
            if (scope === S.LOCAL) L[lp + id] = s[--sp];
            else if (scope === S.FIELD || scope === S.BFIELD) { const t = s[--sp]; this.setField(t, scope, id, s[--sp], NOI); }
            else this.setVar(scope, id, g.self, s[--sp], NOI);
            pc += 3; break;
          }
          case Op.GETI: {
            const scope = code[pc + 1], id = code[pc + 2], index = s[--sp];
            if (scope === S.LOCAL) s[sp++] = elem(L[lp + id], index);
            else if (scope === S.FIELD || scope === S.BFIELD) s[sp - 1] = this.getField(s[sp - 1], scope, id, index);
            else s[sp++] = this.getVar(scope, id, g.self, index);
            pc += 3; break;
          }
          case Op.SETI: {
            const scope = code[pc + 1], id = code[pc + 2], index = s[--sp];
            if (scope === S.LOCAL) L[lp + id] = setElem(L[lp + id], index, s[--sp]);
            else if (scope === S.FIELD || scope === S.BFIELD) { const t = s[--sp]; this.setField(t, scope, id, s[--sp], index); }
            else this.setVar(scope, id, g.self, s[--sp], index);
            pc += 3; break;
          }
          case Op.BIN: { const b2 = s[--sp]; s[sp - 1] = binary(code[pc + 1], s[sp - 1], b2); pc += 2; break; }
          case Op.UN: s[sp - 1] = unary(code[pc + 1], s[sp - 1]); pc += 2; break;
          case Op.JMP: pc = code[pc + 1]; break;
          case Op.JF: pc = truthy(s[--sp]) ? pc + 2 : code[pc + 1]; break;
          case Op.JT: pc = truthy(s[--sp]) ? code[pc + 1] : pc + 2; break;
          case Op.CALL: {
            const argc = code[pc + 2];
            this.sp = sp;
            const r = IMPL[code[pc + 1]]!(g, s, sp - 1, argc);
            sp -= argc; s[sp++] = r;
            pc += 3; break;
          }
          case Op.POP: sp--; pc++; break;
          case Op.DUP: { const n = code[pc + 1]; for (let i = 0; i < n; i++) s[sp + i] = s[sp - n + i]; sp += n; pc += 2; break; }
          case Op.SINK: {
            const n = code[pc + 1], top = s[sp - 1];
            for (let i = sp - 1; i > sp - 1 - n; i--) s[i] = s[i - 1];
            s[sp - 1 - n] = top; pc += 2; break;
          }
          case Op.WITH_BEGIN: {
            if (this.wsp >= WITH_DEPTH) throw new GmlError('with nested too deeply');
            const list = this.wList[this.wsp];
            g.collect(s[--sp], list);
            if (!list.length) { pc = code[pc + 1]; break; }
            this.wSelf[this.wsp] = g.self; this.wOther[this.wsp] = g.other; this.wIdx[this.wsp] = 0;
            this.wsp++;
            g.other = g.self; g.self = list[0];
            pc += 2; break;
          }
          case Op.WITH_NEXT: {
            const w = this.wsp - 1, list = this.wList[w];
            let i = this.wIdx[w] + 1;
            while (i < list.length && !list[i].alive) i++;
            if (i < list.length) { this.wIdx[w] = i; g.self = list[i]; pc = code[pc + 1]; break; }
            this.popWith(); pc += 2; break;
          }
          case Op.WITH_EXIT: this.popWith(); pc++; break;
          case Op.RET: result = s[--sp]; return result;
          case Op.EXIT: return undefined;
          case Op.BOOL: s[sp - 1] = truthy(s[sp - 1]); pc++; break;
          case Op.SELFID: s[sp++] = g.self.id; pc++; break;
          case Op.OTHERID: s[sp++] = g.other ? g.other.id : -4; pc++; break;
          default: throw new GmlError(`bad bytecode ${code[pc]} at ${pc}`);
        }
      }
    } catch (e) {
      if (e instanceof RuntimeError) throw e;
      let k = 0;
      while (k + 1 < b.stmtPc.length && b.stmtPc[k + 1] <= pc) k++;
      throw new RuntimeError(`${b.name}${b.stmtPath[k] ?? ''}: ${(e as Error).message}`, { cause: e });
    } finally {
      while (this.wsp > w0) this.popWith();
      this.sp = sp0; this.lp = lp;
      g.self = savedSelf; g.other = savedOther;
    }
  }

  private popWith(): void {
    const w = --this.wsp;
    this.g.self = this.wSelf[w]!; this.g.other = this.wOther[w];
    this.wList[w].length = 0;
  }

  // ---------------------------------------------------------------- variable access

  private getVar(scope: number, id: number, self: Instance, index: Value = NOI): Value {
    const g = this.g;
    let v: Value;
    switch (scope) {
      case S.SELF: v = self.vars[id]; break;
      case S.GLOBAL: v = g.globals[id]; break;
      case S.BSELF: return g.getIV(self, id, index);
      case S.BGLOBAL: if (index !== NOI) throw new GmlError('not an array'); return g.getGV(id);
      default: throw new GmlError(`bad scope ${scope}`);
    }
    if (v === UNSET) throw new GmlError(`variable ${scope === S.GLOBAL ? 'global.' : ''}${g.a.varNames[id]} not set before reading it`);
    return index === NOI ? v : elem(v, index);
  }

  private setVar(scope: number, id: number, self: Instance, v: Value, index: Value): void {
    const g = this.g;
    switch (scope) {
      case S.SELF: self.vars[id] = index === NOI ? v : setElem(self.vars[id], index, v); return;
      case S.GLOBAL: g.globals[id] = index === NOI ? v : setElem(g.globals[id], index, v); return;
      case S.BSELF: g.setIV(self, id, v, index); return;
      case S.BGLOBAL: if (index !== NOI) throw new GmlError('not an array'); g.setGV(id, v); return;
    }
    throw new GmlError(`bad scope ${scope}`);
  }

  /** inst.var read: an instance id, or an object (its first instance), or a keyword. */
  private getField(t: Value, scope: number, id: number, index: Value = NOI): Value {
    const g = this.g, n = real(t);
    if (n === -5) {
      if (scope === S.BFIELD) throw new GmlError('built-in instance variables are not global');
      return this.getVar(S.GLOBAL, id, g.self, index);
    }
    const inst = g.first(n);
    if (!inst) throw new GmlError(`unable to find an instance for ${g.describe(n)}`);
    return this.getVar(scope === S.FIELD ? S.SELF : S.BSELF, id, inst, index);
  }

  /** inst.var write: objects and `all` write to every matching instance. */
  private setField(t: Value, scope: number, id: number, v: Value, index: Value): void {
    const g = this.g, n = real(t), sc = scope === S.FIELD ? S.SELF : S.BSELF;
    if (n === -5) {
      if (scope === S.BFIELD) throw new GmlError('built-in instance variables are not global');
      return this.setVar(S.GLOBAL, id, g.self, v, index);
    }
    if (n >= 100000 || n === -1 || n === -2) {
      const inst = g.first(n);
      if (!inst) throw new GmlError(`unable to find an instance for ${g.describe(n)}`);
      return this.setVar(sc, id, inst, v, index);
    }
    if (n === -4) throw new GmlError('unable to find an instance for noone');
    let found = false;
    const all = g.instances, len = all.length;
    for (let i = 0; i < len; i++) {
      const inst = all[i];
      if (inst.alive && (n === -3 || inst.obj.isA.has(n))) { this.setVar(sc, id, inst, v, index); found = true; }
    }
    if (!found) throw new GmlError(`unable to find an instance for ${g.describe(n)}`);
  }
}

function elem(arr: Value, index: Value): Value {
  if (!Array.isArray(arr) || arr === UNSET) throw new GmlError('trying to index a variable which is not an array');
  const i = Math.trunc(real(index));
  if (i < 0 || i >= arr.length) throw new GmlError(`array index ${i} out of range (length ${arr.length})`);
  return arr[i];
}

/** a[i] = v. Assigning into a non-array makes a new array; gaps fill with 0, as in GM. */
function setElem(arr: Value, index: Value, v: Value): Value[] {
  const a = Array.isArray(arr) && arr !== UNSET ? arr : [];
  const i = Math.trunc(real(index));
  if (i < 0) throw new GmlError(`negative array index ${i}`);
  while (a.length < i) a.push(0);
  a[i] = v;
  return a;
}

function binary(op: number, a: Value, b: Value): Value {
  switch (op) {
    case BinOp.add: return add(a, b);
    case BinOp.sub: return real(a) - real(b);
    case BinOp.mul: return real(a) * real(b);
    case BinOp.div: { const y = real(b); if (y === 0) throw new GmlError('division by zero'); return real(a) / y; }
    case BinOp.idiv: return idiv(a, b);
    case BinOp.mod: return mod(a, b);
    case BinOp.eq: return equals(a, b);
    case BinOp.neq: return !equals(a, b);
    case BinOp.lt: return compare(a, b) < 0;
    case BinOp.lte: return compare(a, b) <= 0;
    case BinOp.gt: return compare(a, b) > 0;
    case BinOp.gte: return compare(a, b) >= 0;
    case BinOp.xor: return truthy(a) !== truthy(b);
    case BinOp.band: return fromBits(bits(a) & bits(b));
    case BinOp.bor: return fromBits(bits(a) | bits(b));
    case BinOp.bxor: return fromBits(bits(a) ^ bits(b));
    case BinOp.shl: return fromBits(bits(a) << bits(b));
    case BinOp.shr: return fromBits(bits(a) >> bits(b));
  }
  throw new GmlError(`bad operator ${op}`);
}

function unary(op: number, a: Value): Value {
  switch (op) {
    case UnOp.neg: return -real(a);
    case UnOp.not: return !truthy(a);
    case UnOp.bnot: return fromBits(~bits(a));
  }
  throw new GmlError(`bad operator ${op}`);
}

