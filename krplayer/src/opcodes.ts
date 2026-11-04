// Opcode registry, shared by gm2kr (emit), krplayer (compile/execute) and tests.
// Generated from docs/krpj_opcodes.md; numeric ids are internal to a build and never saved in .krpj.

import { OPCODES } from './opcodes.gen.ts';

export interface OpcodeDef {
  name: string;
  /** hidden, compat, family, cap */
  flags: string[];
  /** Raw argument list from the doc, e.g. "num x, num y, obj obj, struct? vars". */
  args: string | null;
  /** Raw GML column from the doc (function name(s), variants or family). */
  gml: string | null;
}

export { OPCODES };

const ids = new Map<string, number>(OPCODES.map((o, i) => [o.name, i]));

/** Numeric id for an opcode name. Unknown names fail loudly with where they came from. */
export function opcodeId(name: string, where: string): number {
  const id = ids.get(name);
  if (id === undefined) throw new Error(`unknown opcode "${name}" at ${where}`);
  return id;
}
