// GML value rules: coercion, truthiness, equality, arithmetic, string conversion.
// Builtins and the VM call these; nothing else re-implements coercion (see architecture.md).
//
// Representation: real = number, string = string, bool = boolean, undefined = undefined,
// array = GArray (a JS array carrying its copy-on-write owner), struct = GmStruct, method = GmMethod.
// Asset references and instance ids are numbers; GM 2023.8+ typed refs and int64 are not
// modelled yet (int64 literals become reals; see gm_gotchas.md).

export type Value = number | string | boolean | undefined | GArray | GmStruct | GmMethod;

/** A GML array. `o` is the owner token of the variable it was last written through (copy-on-write). */
export interface GArray extends Array<Value> { o?: number }

/** Anything with GML variables: instances, structs and the global scope. Keys are variable slots. */
export class Scope {
  readonly vars = new Map<number, Value>();
}

export class GmStruct extends Scope {
  /** Constructor function key, or null for literals / json_parse. */
  ctor: string | null;
  constructor(ctor: string | null = null) { super(); this.ctor = ctor; }
}

/** A function value: a user function (index into the project's functions), bound to a scope or not. */
export class GmMethod {
  readonly fn: number;
  readonly self: Scope | null;
  readonly name: string;
  constructor(fn: number, self: Scope | null, name: string) { this.fn = fn; this.self = self; this.name = name; }
}

/** GM's default math_get_epsilon(). Real comparisons use it. */
export const EPSILON = 0.00001;

export class GmlError extends Error {}
/** A GML feature krplayer lacks. Never caught by GML try/catch, so gaps stay loud. */
export class NotImplemented extends GmlError {}

export const typeName = (v: Value): string =>
  typeof v === 'number' ? 'number' : typeof v === 'string' ? 'string' : typeof v === 'boolean' ? 'bool' : v === undefined ? 'undefined'
    : v instanceof GmStruct ? 'struct' : v instanceof GmMethod ? 'method' : 'array';

/** A value used as a real. Bools are 1/0; anything else is an error, like GM. */
export function real(v: Value): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new GmlError(`expected a number, got ${typeName(v)}${typeof v === 'string' ? ` "${v}"` : ''}`);
}

/** real() for function arguments that GM also accepts as undefined (-> 0). */
export const num = (v: Value): number => (v === undefined ? 0 : real(v));

/** if/while conditions: reals are true above 0.5. */
export function truthy(v: Value): boolean {
  if (typeof v === 'number') return v > 0.5;
  if (typeof v === 'boolean') return v;
  if (v === undefined) return false;
  throw new GmlError(`unable to convert ${typeName(v)} to bool`);
}

export function add(a: Value, b: Value): Value {
  if (typeof a === 'string' && typeof b === 'string') return a + b;
  if (typeof a === 'string' || typeof b === 'string') throw new GmlError(`unable to add ${typeName(a)} and ${typeName(b)}`);
  return real(a) + real(b);
}

/** GM's number pattern for comparing a string with a real. Unanchored at the end: "5abc" reads as 5. */
const CMP_NUM = /^[-+]?(?:[0-9]{0,30}\.)?[0-9]{1,30}(?:[Ee][-+]?[1-2]?[0-9])?/;
/** A string compared with a real: its leading number after trimming, or NaN if it has none. */
function cmpStr(s: string): number {
  const m = CMP_NUM.exec(s.trim());
  return m ? Number(m[0]) : NaN;
}

export function equals(a: Value, b: Value): boolean {
  const an = typeof a === 'number' || typeof a === 'boolean', bn = typeof b === 'number' || typeof b === 'boolean';
  if (an && bn) return Math.abs(real(a) - real(b)) <= EPSILON;
  // Real vs numeric string compares as numbers ("5" == 5); a non-numeric string is just unequal.
  if (an && typeof b === 'string') return Math.abs(real(a) - cmpStr(b)) <= EPSILON;
  if (bn && typeof a === 'string') return Math.abs(cmpStr(a) - real(b)) <= EPSILON;
  return a === b; // strings by value, undefined == undefined, everything else by reference
}

/** a < b (-1), a == b (0), a > b (1). Reals use the epsilon; strings compare by code unit. */
export function compare(a: Value, b: Value): number {
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  // A string against a real is read as a number (c_wait("5") in DR ch2); a non-numeric one is an error.
  const x = typeof a === 'string' ? cmpStr(a) : real(a), y = typeof b === 'string' ? cmpStr(b) : real(b);
  if (Number.isNaN(x) || Number.isNaN(y)) {
    if (typeof a === 'string' || typeof b === 'string') throw new GmlError(`unable to compare ${typeName(a)} and ${typeName(b)}`);
  }
  return Math.abs(x - y) <= EPSILON ? 0 : x < y ? -1 : 1;
}

/** GML modulo / div keep the dividend's sign (like JS %). Division by zero is an error. */
export function mod(a: Value, b: Value): number {
  const y = real(b);
  if (y === 0) throw new GmlError('modulo by zero');
  return real(a) % y;
}
export function idiv(a: Value, b: Value): number {
  const y = real(b);
  if (y === 0) throw new GmlError('integer division by zero');
  return Math.trunc(real(a) / y);
}
/** Bitwise operators work on 64-bit ints in GM; reals are truncated. */
export function bits(a: Value): bigint { return BigInt(Math.trunc(real(a))); }
export const fromBits = (v: bigint): number => Number(BigInt.asIntN(64, v));
/** Fast path for bitwise ops whose operands fit in 32 bits (the common case). */
export const fits32 = (x: number) => x >= -2147483648 && x <= 2147483647;

/** string() of a real: integers print bare, others with 2 decimals. */
export function realStr(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(2);
  return s === '-0.00' ? '0.00' : s;
}

/** string(): reals as realStr, structs and arrays like GM's debug form. */
export function str(v: Value, names?: (slot: number) => string): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return realStr(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v === undefined) return 'undefined';
  if (v instanceof GmMethod) return `function ${v.name}`;
  if (v instanceof GmStruct) {
    const parts = [...v.vars].map(([k, x]) => `${names ? names(k) : k} : ${typeof x === 'string' ? JSON.stringify(x) : str(x, names)}`);
    return parts.length ? `{ ${parts.join(', ')} }` : '{  }';
  }
  return `[ ${v.map((x) => (typeof x === 'string' ? JSON.stringify(x) : str(x, names))).join(',')} ]`;
}

/** A new array owned by nobody (it takes the owner of the first variable it is stored in). */
export function newArray(n = 0, fill: Value = 0): GArray {
  const a: GArray = new Array(n);
  for (let i = 0; i < n; i++) a[i] = fill;
  return a;
}
