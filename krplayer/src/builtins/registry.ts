// Built-in opcode implementations, indexed by opcode id. Category files call define() at import;
// the compiler rejects opcodes with no implementation (named, with their location).

import { opcodeId } from '../opcodes.ts';
import type { Value } from '../value.ts';
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
