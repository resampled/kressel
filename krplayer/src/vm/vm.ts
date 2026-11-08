// The bytecode interpreter. Switch dispatch over a flat Int32Array; the value stack, locals, argument
// frames and `with` frames are preallocated, so running a block allocates nothing (except GML values).

import { BinOp, Op, S, UnOp, type Block } from '../compile/bytecode.ts';
import { IMPL } from '../builtins/registry.ts';
import {
  add, bits, compare, equals, fits32, fromBits, GmlError, GmMethod, GmStruct, idiv, mod, NotImplemented, real, Scope, truthy, typeName,
  type GArray, type Value,
} from '../value.ts';
import { Instance, NOI } from '../runtime/instance.ts';
import type { Game } from '../runtime/game.ts';

const STACK = 1 << 14, LOCALS = 1 << 16, ARGS = 1 << 14, WITH_DEPTH = 256, CALL_DEPTH = 512, TRY_DEPTH = 256;
/** Backward jumps allowed per frame before the watchdog stops the game (runaway loops). */
const BUDGET = 50_000_000;

/** A runtime error already annotated with its script location. */
export class RuntimeError extends Error {}
/** The infinite-loop watchdog: never caught by GML try/catch. */
class Watchdog extends Error {}
const rootOf = (e: unknown): unknown => { while (e instanceof RuntimeError && e.cause) e = e.cause; return e; };
/** Whether a GML catch may handle e: GML errors only, not krplayer gaps, the watchdog or krplayer bugs. */
const catchable = (e: unknown): boolean => { const r = rootOf(e); return r instanceof GmlError && !(r instanceof NotImplemented); };

export class VM {
  readonly stack: Value[] = new Array(STACK).fill(undefined);
  sp = 0;
  private readonly locals: Value[] = new Array(LOCALS).fill(undefined);
  private lp = 0;
  private readonly args: Value[] = new Array(ARGS).fill(undefined);
  private ap = 0;
  private readonly wList: Scope[][] = Array.from({ length: WITH_DEPTH }, () => []);
  private readonly wIdx = new Int32Array(WITH_DEPTH);
  private readonly wSelf: (Scope | null)[] = new Array(WITH_DEPTH).fill(null);
  private readonly wOther: (Scope | null)[] = new Array(WITH_DEPTH).fill(null);
  private wsp = 0;
  /** try handlers: catch pc, and the value stack / with depth to unwind to. */
  private readonly tryPc = new Int32Array(TRY_DEPTH);
  private readonly trySp = new Int32Array(TRY_DEPTH);
  private readonly tryW = new Int32Array(TRY_DEPTH);
  private tp = 0;
  private depth = 0;
  budget = BUDGET;
  /** The block running right now (event_inherited needs its object and event). */
  current: Block | null = null;
  private readonly g: Game;

  constructor(g: Game) { this.g = g; }

  /** Runs a block as self (with other) and an argument frame. Returns its ctr_return value. */
  run(b: Block, self: Scope, other: Scope | null, argBase = this.ap, argc = 0): Value {
    const g = this.g, code = b.code, consts = b.consts as Value[], s = this.stack, L = this.locals, A = this.args;
    const savedSelf = g.self, savedOther = g.other, sp0 = this.sp, lp = this.lp, w0 = this.wsp, t0 = this.tp, savedBlock = this.current;
    if (lp + b.nLocals > LOCALS || ++this.depth > CALL_DEPTH) { this.depth--; throw new RuntimeError(`${b.name}: call stack too deep (runaway recursion?)`); }
    for (let i = 0; i < b.nLocals; i++) L[lp + i] = undefined;
    this.lp += b.nLocals;
    g.self = self; g.other = other; this.current = b;
    let sp = sp0, pc = 0;
    try {
      for (;;) try {
      for (;;) {
        if (sp > STACK - 64) throw new GmlError('value stack overflow');
        switch (code[pc]) {
          case Op.CONST: s[sp++] = consts[code[pc + 1]]; pc += 2; break;
          case Op.GET: {
            const scope = code[pc + 1], id = code[pc + 2];
            if (scope === S.LOCAL) s[sp++] = L[lp + id];
            else if (scope === S.ARG) s[sp++] = id >= 0 ? (id < argc ? A[argBase + id] : undefined) : id === -2 ? argc : A.slice(argBase, argBase + argc);
            else if (scope === S.FIELD || scope === S.BFIELD) s[sp - 1] = this.getField(s[sp - 1], scope, id);
            else s[sp++] = this.getVar(scope, id, g.self);
            pc += 3; break;
          }
          case Op.SET: {
            const scope = code[pc + 1], id = code[pc + 2], own = code[pc + 3];
            if (scope === S.LOCAL) L[lp + id] = owned(s[--sp], own);
            else if (scope === S.ARG) { if (id < 0) throw new GmlError('argument is read-only'); A[argBase + id] = owned(s[--sp], own); }
            else if (scope === S.FIELD || scope === S.BFIELD) { const t = s[--sp]; this.setField(t, scope, id, owned(s[--sp], own), NOI, own); }
            else this.setVar(scope, id, g.self, owned(s[--sp], own), NOI, own);
            pc += 4; break;
          }
          case Op.GETI: {
            const scope = code[pc + 1], id = code[pc + 2], index = s[--sp];
            if (scope === S.LOCAL) s[sp++] = elem(L[lp + id], index);
            else if (scope === S.ARG) {
              const i = Math.trunc(real(index));
              if (i < 0 || i >= argc) throw new GmlError(`argument index ${i} out of range (${argc} arguments)`);
              s[sp++] = A[argBase + i];
            } else if (scope === S.FIELD || scope === S.BFIELD) s[sp - 1] = this.getField(s[sp - 1], scope, id, index);
            else s[sp++] = this.getVar(scope, id, g.self, index);
            pc += 3; break;
          }
          case Op.SETI: {
            const scope = code[pc + 1], id = code[pc + 2], own = code[pc + 3], index = s[--sp];
            if (scope === S.LOCAL) L[lp + id] = setElem(L[lp + id], index, s[--sp], own);
            else if (scope === S.ARG) {
              const i = Math.trunc(real(index));
              if (i < 0 || i >= 16) throw new GmlError(`argument index ${i} out of range`);
              A[argBase + i] = s[--sp];
            } else if (scope === S.FIELD || scope === S.BFIELD) { const t = s[--sp]; this.setField(t, scope, id, s[--sp], index, own); }
            else this.setVar(scope, id, g.self, s[--sp], index, own);
            pc += 4; break;
          }
          case Op.AROWV: {
            const scope = code[pc + 1], id = code[pc + 2], own = code[pc + 3], index = s[--sp];
            let arr: GArray;
            if (scope === S.LOCAL) L[lp + id] = arr = ownArray(L[lp + id], own);
            else if (scope === S.FIELD) { const t = s[--sp]; arr = this.rowOf(this.scopeOf(t), id, own); }
            else if (scope === S.SELF || scope === S.GLOBAL) arr = this.rowOf(scope === S.SELF ? g.self : g.globalScope, id, own);
            else throw new GmlError('built-in variables are not 2D arrays');
            s[sp++] = row(arr, index, own);
            pc += 4; break;
          }
          case Op.AROW: { const index = s[--sp]; s[sp - 1] = row(asArray(s[sp - 1]), index, code[pc + 1]); pc += 2; break; }
          case Op.AGET: { const index = s[--sp]; s[sp - 1] = elem(s[sp - 1], index); pc++; break; }
          case Op.ASET: {
            const index = s[--sp], arr = asArray(s[--sp]), v = s[--sp];
            put(arr, index, owned(v, code[pc + 1]));
            pc += 2; break;
          }
          case Op.ARRAY: {
            const n = code[pc + 1], arr: GArray = new Array(n);
            for (let i = 0; i < n; i++) arr[i] = s[sp - 1 - i];
            sp -= n; s[sp++] = arr; pc += 2; break;
          }
          case Op.BIN: { const b2 = s[--sp]; s[sp - 1] = binary(code[pc + 1], s[sp - 1], b2); pc += 2; break; }
          case Op.UN: s[sp - 1] = unary(code[pc + 1], s[sp - 1]); pc += 2; break;
          case Op.JMP: { const t = code[pc + 1]; if (t < pc && --this.budget < 0) this.runaway(); pc = t; break; }
          case Op.JF: { const t = code[pc + 1]; if (truthy(s[--sp])) pc += 2; else { if (t < pc && --this.budget < 0) this.runaway(); pc = t; } break; }
          case Op.JT: { const t = code[pc + 1]; if (!truthy(s[--sp])) pc += 2; else { if (t < pc && --this.budget < 0) this.runaway(); pc = t; } break; }
          case Op.CALL: {
            const argc2 = code[pc + 2];
            this.sp = sp;
            const r = IMPL[code[pc + 1]]!(g, s, sp - 1, argc2);
            sp -= argc2; s[sp++] = r;
            pc += 3; break;
          }
          case Op.CALLF: {
            const n = code[pc + 2];
            this.sp = sp;
            const r = this.invoke(code[pc + 1], g.self, g.other, n);
            sp -= n; s[sp++] = r;
            pc += 3; break;
          }
          case Op.CALLV: {
            const n = code[pc + 1], f = s[--sp], on = s[--sp];
            this.sp = sp;
            let r: Value;
            if (f instanceof GmMethod) {
              const self = f.self ?? this.scopeOf(on);
              r = this.invoke(f.fn, self, self === g.self ? g.other : g.self, n);
            } else if (typeof f === 'number') {
              r = this.invoke(g.scriptFunction(f), this.scopeOf(on), g.other, n);
            } else throw new GmlError(`${typeName(f)} is not a function`);
            sp -= n; s[sp++] = r;
            pc += 2; break;
          }
          case Op.NEW: case Op.NEWV: {
            const isV = code[pc] === Op.NEWV, n = code[pc + (isV ? 1 : 2)];
            let fn: number;
            if (!isV) fn = code[pc + 1];
            else {
              const f = s[--sp];
              fn = f instanceof GmMethod ? f.fn : typeof f === 'number' ? g.scriptFunction(f) : -1;
              if (fn < 0) throw new GmlError(`${typeName(f)} is not a constructor`);
            }
            this.sp = sp;
            const st = new GmStruct(g.a.functions[fn].name);
            this.invoke(fn, st, g.self, n);
            sp -= n; s[sp++] = st;
            pc += isV ? 2 : 3; break;
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
            while (i < list.length && !live(list[i])) i++;
            if (i < list.length) { this.wIdx[w] = i; g.self = list[i]; pc = code[pc + 1]; break; }
            this.popWith(); pc += 2; break;
          }
          case Op.WITH_EXIT: this.popWith(); pc++; break;
          case Op.RET: return s[--sp];
          case Op.EXIT: return undefined;
          case Op.BOOL: s[sp - 1] = truthy(s[sp - 1]); pc++; break;
          case Op.SELFID: s[sp++] = scopeValue(g.self); pc++; break;
          case Op.OTHERID: s[sp++] = g.other ? scopeValue(g.other) : -4; pc++; break;
          case Op.TRY_BEGIN: {
            if (this.tp >= TRY_DEPTH) throw new GmlError('try nested too deeply');
            const h = this.tp++;
            this.tryPc[h] = code[pc + 1]; this.trySp[h] = sp; this.tryW[h] = this.wsp;
            pc += 2; break;
          }
          case Op.TRY_END: this.tp--; pc++; break;
          default: throw new GmlError(`bad bytecode ${code[pc]} at ${pc}`);
        }
      }
      } catch (e) {
        // A GML error inside a try of this frame: unwind to its handler and run the catch.
        if (this.tp <= t0 || !catchable(e)) throw e;
        const h = --this.tp;
        while (this.wsp > this.tryW[h]) this.popWith();
        sp = this.trySp[h]; pc = this.tryPc[h];
        s[sp++] = this.exception(e, b);
      }
    } catch (e) {
      let k = 0;
      while (k + 1 < b.stmtPc.length && b.stmtPc[k + 1] <= pc) k++;
      const where = `${b.name}${b.stmtPath[k] ?? ''}`;
      // Each frame adds itself, so the message reads like a GML call stack.
      if (e instanceof RuntimeError) { e.message += `
  called from ${where}`; throw e; }
      throw new RuntimeError(`${where}: ${(e as Error).message}`, { cause: e });
    } finally {
      while (this.wsp > w0) this.popWith();
      this.tp = t0; this.sp = sp0; this.lp = lp; this.depth--; this.current = savedBlock;
      g.self = savedSelf; g.other = savedOther;
    }
  }

  /** Calls user function fn; its n arguments are on top of the value stack (first argument on top). */
  invoke(fn: number, self: Scope, other: Scope | null, n: number): Value {
    const f = this.g.a.functions[fn], s = this.stack, A = this.args, base = this.ap, top = this.sp - 1;
    if (base + 16 + n > ARGS) throw new GmlError('argument stack overflow');
    for (let k = 0; k < n; k++) A[base + k] = s[top - k];
    for (let k = n; k < 16; k++) A[base + k] = undefined;
    this.ap = base + Math.max(n, 16);
    try { return this.run(f.block, self, other, base, n); } finally { this.ap = base; }
  }

  /** Calls a function value from a builtin (callbacks, script_execute with a computed id). */
  callValue(f: Value, self: Scope, args: Value[]): Value {
    const fn = f instanceof GmMethod ? f.fn : typeof f === 'number' ? this.g.scriptFunction(f) : -1;
    if (fn < 0) throw new GmlError(`${typeName(f)} is not a function`);
    const s = this.stack, sp0 = this.sp;
    for (let k = args.length - 1; k >= 0; k--) s[this.sp++] = args[k];
    try { return this.invoke(fn, f instanceof GmMethod && f.self ? f.self : self, this.g.self, args.length); } finally { this.sp = sp0; }
  }

  private runaway(): never {
    throw new Watchdog('too many loop iterations in one frame (infinite loop?)');
  }

  /** The value a catch receives for a runtime error: GM's error struct. */
  private exception(e: unknown, b: Block): Value {
    const st = new GmStruct(), a = this.g.a, msg = (rootOf(e) as Error).message;
    st.vars.set(a.varSlot('message'), msg);
    st.vars.set(a.varSlot('longMessage'), (e as Error).message);
    st.vars.set(a.varSlot('script'), b.name);
    st.vars.set(a.varSlot('stacktrace'), [b.name]);
    return st;
  }

  private popWith(): void {
    const w = --this.wsp;
    this.g.self = this.wSelf[w]!; this.g.other = this.wOther[w];
    this.wList[w].length = 0;
  }

  // ---------------------------------------------------------------- variable access

  /** The scope a stack value names: an instance (by id or object), a struct, or self/other. */
  scopeOf(t: Value): Scope {
    if (t instanceof Scope) return t;
    const n = real(t);
    if (n === -5) return this.g.globalScope;
    const inst = this.g.first(n);
    if (!inst) throw new GmlError(`unable to find an instance for ${this.g.describe(n)}`);
    return inst;
  }

  private getVar(scope: number, id: number, self: Scope, index: Value = NOI): Value {
    const g = this.g;
    let v: Value;
    switch (scope) {
      case S.SELF: v = self.vars.get(id); if (v === undefined && !self.vars.has(id)) this.unset(self, id); break;
      case S.GLOBAL: v = g.globalScope.vars.get(id); if (v === undefined && !g.globalScope.vars.has(id)) this.unset(g.globalScope, id); break;
      case S.BSELF: if (!(self instanceof Instance)) throw new GmlError(`built-in variable ${g.ivName(id)} on a struct`); return g.getIV(self, id, index);
      case S.BGLOBAL: return g.getGV(id, index);
      default: throw new GmlError(`bad scope ${scope}`);
    }
    return index === NOI ? v : elem(v, index);
  }

  private unset(sc: Scope, id: number): never {
    const name = this.g.a.varNames[id];
    throw new GmlError(sc === this.g.globalScope ? `global variable global.${name} not set before reading it`
      : `variable ${name} not set before reading it${sc instanceof Instance ? ` (${sc.obj.name})` : ''}`);
  }

  private setVar(scope: number, id: number, self: Scope, v: Value, index: Value, own: number): void {
    const g = this.g;
    switch (scope) {
      case S.SELF: self.vars.set(id, index === NOI ? v : setElem(self.vars.get(id), index, v, own)); return;
      case S.GLOBAL: { const m = g.globalScope.vars; m.set(id, index === NOI ? v : setElem(m.get(id), index, v, own)); return; }
      case S.BSELF: if (!(self instanceof Instance)) throw new GmlError(`built-in variable ${g.ivName(id)} on a struct`); g.setIV(self, id, v, index); return;
      case S.BGLOBAL: g.setGV(id, v, index); return;
    }
    throw new GmlError(`bad scope ${scope}`);
  }

  /** inst.var / struct.var read: an instance id, an object (its first instance), a struct, or a keyword. */
  private getField(t: Value, scope: number, id: number, index: Value = NOI): Value {
    const sc = this.scopeOf(t);
    if (sc === this.g.globalScope && scope === S.FIELD) return this.getVar(S.GLOBAL, id, sc, index);
    return this.getVar(scope === S.FIELD ? S.SELF : S.BSELF, id, sc, index);
  }

  /** inst.var write: objects and `all` write to every matching instance. */
  private setField(t: Value, scope: number, id: number, v: Value, index: Value, own: number): void {
    const g = this.g, sc = scope === S.FIELD ? S.SELF : S.BSELF;
    if (t instanceof Scope || real(t) === -5 || real(t) >= 100000 || real(t) === -1 || real(t) === -2) {
      const target = this.scopeOf(t);
      return this.setVar(target === g.globalScope && sc === S.SELF ? S.GLOBAL : sc, id, target, v, index, own);
    }
    const n = real(t);
    if (n === -4) return; // writes to noone go nowhere
    // obj.x = v writes to every instance of obj: with none, nothing happens (reads are the error).
    const all = g.instances, len = all.length;
    for (let i = 0; i < len; i++) {
      const inst = all[i];
      if (inst.alive && inst.active && (n === -3 || inst.obj.isA.has(n))) this.setVar(sc, id, inst, v, index, own);
    }
  }

  /** The array in sc.vars[id], made writable through owner own (copied or created as needed). */
  private rowOf(sc: Scope, id: number, own: number): GArray {
    const arr = ownArray(sc.vars.get(id), own);
    sc.vars.set(id, arr);
    return arr;
  }
}

const live = (s: Scope) => !(s instanceof Instance) || (s.alive && s.active);
const scopeValue = (s: Scope): Value => (s instanceof Instance ? s.id : (s as GmStruct));

/** An array value stored in a variable for the first time takes that variable as its owner. */
function owned(v: Value, own: number): Value {
  if (Array.isArray(v) && v.o === undefined && own) setOwner(v, own);
  return v;
}
/** The owner is bookkeeping, not part of the array: non-enumerable, so it never shows up as an element. */
function setOwner(a: GArray, own: number): GArray {
  Object.defineProperty(a, 'o', { value: own, writable: true, configurable: true });
  return a;
}

function asArray(v: Value): GArray {
  if (!Array.isArray(v)) throw new GmlError('trying to index a variable which is not an array');
  return v;
}

/** v as an array writable through owner own: copied if someone else owns it, created if not an array. */
function ownArray(v: Value, own: number): GArray {
  if (!Array.isArray(v)) return setOwner([], own);
  if (own && v.o !== own) return setOwner(v.slice(), own);
  return v;
}

/** arr[index] as a writable row (multi-dimensional write). */
function row(arr: GArray, index: Value, own: number): GArray {
  const i = Math.trunc(real(index));
  if (i < 0) throw new GmlError(`negative array index ${i}`);
  const r = ownArray(i < arr.length ? arr[i] : undefined, own);
  put(arr, i, r);
  return r;
}

function elem(arr: Value, index: Value): Value {
  if (!Array.isArray(arr)) throw new GmlError('trying to index a variable which is not an array');
  const i = Math.trunc(real(index));
  if (i < 0 || i >= arr.length) throw new GmlError(`array index ${i} out of range (length ${arr.length})`);
  return arr[i];
}

/** arr[index] = v, padding with 0 like GM. */
function put(arr: GArray, index: Value, v: Value): void {
  const i = Math.trunc(real(index));
  if (i < 0) throw new GmlError(`negative array index ${i}`);
  if (i > 1 << 26) throw new GmlError(`array index ${i} too large`);
  while (arr.length < i) arr.push(0);
  arr[i] = v;
}

/** a[i] = v on a variable's current value: copy-on-write, and a non-array becomes a new array. */
function setElem(cur: Value, index: Value, v: Value, own: number): GArray {
  const a = ownArray(cur, own);
  put(a, index, owned(v, own));
  return a;
}

function binary(op: number, a: Value, b: Value): Value {
  switch (op) {
    case BinOp.add: return typeof a === 'number' && typeof b === 'number' ? a + b : add(a, b);
    case BinOp.sub: return real(a) - real(b);
    case BinOp.mul: return real(a) * real(b);
    // Real division by zero gives inf / -inf / NaN, no error (gm_gotchas.md); `div` and `%` still fail.
    case BinOp.div: return real(a) / real(b);
    case BinOp.idiv: return idiv(a, b);
    case BinOp.mod: return mod(a, b);
    case BinOp.eq: return equals(a, b);
    case BinOp.neq: return !equals(a, b);
    case BinOp.lt: return compare(a, b) < 0;
    case BinOp.lte: return compare(a, b) <= 0;
    case BinOp.gt: return compare(a, b) > 0;
    case BinOp.gte: return compare(a, b) >= 0;
    case BinOp.xor: return truthy(a) !== truthy(b);
  }
  const x = Math.trunc(real(a)), y = Math.trunc(real(b));
  if (fits32(x) && fits32(y) && op !== BinOp.shl) {
    switch (op) {
      case BinOp.band: return x & y;
      case BinOp.bor: return x | y;
      case BinOp.bxor: return x ^ y;
      case BinOp.shr: return y < 32 ? x >> y : x < 0 ? -1 : 0;
    }
  }
  switch (op) {
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
    case UnOp.bnot: { const x = Math.trunc(real(a)); return fits32(x) ? ~x : fromBits(~bits(a)); }
  }
  throw new GmlError(`bad operator ${op}`);
}
