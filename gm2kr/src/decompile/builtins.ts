// GML built-in function name -> krpj opcode, derived from the opcode table (docs/krpj_opcodes.md).
//   `name`                      -> [op, ...args]
//   `a` / `b` + ref `x`/`y`     -> [op, "x" | "y", ...args]   (variants paired by position)
//   `a` `b` + ref fn            -> [op, "a" | "b", ...args]   (ref is the GML name, minus a prefix for some)

import { OPCODES } from '../../../krplayer/src/opcodes.ts';

export interface Builtin { op: string; ref: string | null }

/** Variant refs that drop a prefix from the GML name (see the opcode notes). */
const REF_PREFIX: Record<string, string> = { opr_dtrig: 'd', opr_is_type: 'is_', var_arr_iterate: 'array_' };

function build(): Map<string, Builtin> {
  const map = new Map<string, Builtin>();
  for (const o of OPCODES) {
    if (!o.gml || o.flags.includes('family')) continue;
    const names = [...o.gml.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]);
    const refVals = /^ref ((?:`\w+`\/?)+)/.exec(o.args ?? '')?.[1].match(/\w+/g) ?? null;
    const refFree = /^ref \w/.test(o.args ?? '');
    names.forEach((n, i) => {
      if (map.has(n)) return;
      if (refVals) { if (refVals.length === names.length) map.set(n, { op: o.name, ref: refVals[i] }); }
      else if (refFree) map.set(n, { op: o.name, ref: n.slice((REF_PREFIX[o.name] ?? '').length) });
      else map.set(n, { op: o.name, ref: null });
    });
  }
  return map;
}

export const BUILTINS = build();
