// GML value rules: coercion, truthiness, equality, arithmetic, string conversion.
// Builtins and the VM call these; nothing else re-implements coercion (see architecture.md).
//
// Representation: real = number, string = string, bool = boolean, undefined = undefined,
// array = Value[]. Asset references are their index (a number); GM 2023.8+ typed refs
// are not modelled yet (see gm_gotchas.md).

export type Value = number | string | boolean | undefined | Value[];

/** GM's default math_get_epsilon(). Real comparisons use it. */
export const EPSILON = 0.00001;

export class GmlError extends Error {}

const typeName = (v: Value): string =>
  typeof v === 'number' ? 'number' : typeof v === 'string' ? 'string' : typeof v === 'boolean' ? 'bool' : v === undefined ? 'undefined' : 'array';

/** A value used as a real. Bools are 1/0; anything else is an error, like GM. */
export function real(v: Value): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new GmlError(`expected a number, got ${typeName(v)}${typeof v === 'string' ? ` "${v}"` : ''}`);
}

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

export function equals(a: Value, b: Value): boolean {
  const an = typeof a === 'number' || typeof a === 'boolean', bn = typeof b === 'number' || typeof b === 'boolean';
  if (an && bn) return Math.abs(real(a) - real(b)) <= EPSILON;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  return a === b; // undefined == undefined, same array
}

/** a < b (-1), a == b (0), a > b (1). Reals use the epsilon; strings compare by code unit. */
export function compare(a: Value, b: Value): number {
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  const x = real(a), y = real(b);
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

/** string(): integers print bare, other reals with 2 decimals. */
export function str(v: Value): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN';
    if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v === undefined) return 'undefined';
  return `[ ${v.map(str).join(',')} ]`;
}
