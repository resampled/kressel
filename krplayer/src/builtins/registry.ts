// Built-in opcode implementations, indexed by opcode id. Category files call define() at import;
// the compiler rejects opcodes with no implementation (named, with their location).

import { opcodeId } from '../opcodes.ts';
import { argBool, argReal, GmlError, NotImplemented, real, str as toStr, truthy, type Value } from '../value.ts';
import type { Game } from '../runtime/game.ts';

/**
 * Arguments were pushed last-to-first, so argument k is s[top - k].
 * Ref (variant) arguments arrive as their string.
 */
export type BuiltinFn = (g: Game, s: Value[], top: number, argc: number) => Value;

export const IMPL: (BuiltinFn | undefined)[] = [];

export function define(name: string, fn: BuiltinFn): void {
  const id = opcodeId(name, 'krplayer builtins');
  if (IMPL[id]) throw new Error(`builtin ${name} defined twice`);
  IMPL[id] = fn;
}

/** A family opcode: the first argument names the member (GML name minus the family prefix). */
export function family(name: string, prefix: string, members: Record<string, BuiltinFn>): void {
  define(name, (g, s, t, argc) => {
    const m = s[t], f = typeof m === 'string' ? members[m] : undefined;
    if (!f) throw new NotImplemented(`${prefix}${String(m)} is not implemented in krplayer yet`);
    return f(g, s, t - 1, argc - 1);
  });
}

/** Argument helpers: argument k of a call whose first argument is s[t]. */
export const n = (s: Value[], t: number, k: number): number => argReal(s[t - k]);
export const b = (s: Value[], t: number, k: number): boolean => argBool(s[t - k]);
export const str = (s: Value[], t: number, k: number): string => toStr(s[t - k]);
/** An optional argument, or its default when not passed. */
export const opt = (s: Value[], t: number, k: number, argc: number, def: number): number => (k < argc ? argReal(s[t - k]) : def);
