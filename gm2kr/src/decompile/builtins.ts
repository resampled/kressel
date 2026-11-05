// GML built-in function name -> krpj opcode, derived from the opcode table (docs/krpj_opcodes.md).
//   `name`                      -> [op, ...args]
//   `a` / `b` + ref `x`/`y`     -> [op, "x" | "y", ...args]   (variants paired by position)
//   `a` `b` + ref fn            -> [op, "a" | "b", ...args]   (ref is the GML name, minus a prefix for some)
//   family `prefix_*`           -> [op, name minus prefix, ...args]
// Every `colour` name also answers to its `color` spelling, as in GML.

import { OPCODES } from '../../../krplayer/src/opcodes.ts';

export interface Builtin { op: string; ref: string | null }

/** Variant refs that drop a prefix from the GML name (see the opcode notes). */
const REF_PREFIX: Record<string, string> = { opr_dtrig: 'd', opr_is_type: 'is_', var_arr_iterate: 'array_', snd_3d: 'audio_' };

const exact = new Map<string, Builtin>();
/** [prefix, op, prefix the ref drops], longest prefix first. */
const families: [string, string, string][] = [];

for (const o of OPCODES) {
  if (!o.gml) continue;
  if (o.flags.includes('family')) {
    const gml = o.gml.replace(/\([^)]*\)/g, ''); // "(`load`, `is_loaded`)" lists members, not functions
    for (const m of gml.matchAll(/`([a-z][a-z0-9_]*_)\*`/g)) families.push([m[1], o.name, REF_PREFIX[o.name] ?? m[1]]);
    continue;
  }
  const names = [...o.gml.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]);
  const refVals = /^ref ((?:`\w+`\/?)+)/.exec(o.args ?? '')?.[1].match(/\w+/g) ?? null;
  const refFree = /^ref \w/.test(o.args ?? '');
  names.forEach((n, i) => {
    if (exact.has(n)) return;
    if (refVals) { if (refVals.length === names.length) exact.set(n, { op: o.name, ref: refVals[i] }); }
    else if (refFree) exact.set(n, { op: o.name, ref: n.slice((REF_PREFIX[o.name] ?? '').length) });
    else exact.set(n, { op: o.name, ref: null });
  });
}
for (const [n, b] of [...exact]) if (n.includes('colour')) { const us = n.replaceAll('colour', 'color'); if (!exact.has(us)) exact.set(us, b); }
families.sort((a, b) => b[0].length - a[0].length);

/** Exact (non-family) built-ins, for tests and tooling. */
export const BUILTINS: ReadonlyMap<string, Builtin> = exact;

export function lookupBuiltin(name: string): Builtin | undefined {
  const b = exact.get(name);
  if (b) return b;
  for (const [prefix, op, drop] of families) if (name.startsWith(prefix)) return { op, ref: name.slice(drop.length) };
  return undefined;
}
