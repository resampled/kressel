// Debug start state for ?room= warps (see architecture.md "Debug start room"): ?set= and ?call= params,
// run in URL order just before the warp room is entered, so the room sees the globals the skipped rooms would set.

import { GmMethod, type GArray, type Value } from '../value.ts';
import type { Game } from './game.ts';

/** Splits on commas outside quotes and parentheses. */
const split = (s: string): string[] => s.match(/(?:"[^"]*"|\([^)]*\)|[^,])+/g)?.map((x) => x.trim()) ?? [];

/** A param value: a number, true/false (1/0, like GM), or a string ("quoted" or bare). */
function literal(s: string): Value {
  if (/^"[^"]*"$/.test(s)) return s.slice(1, -1);
  if (s === 'true' || s === 'false') return +(s === 'true');
  return s !== '' && Number.isFinite(+s) ? +s : s;
}

function setter(g: Game, item: string): () => void {
  const m = /^(?:global\.)?(\w+)(?:\[(\d+)\])?=(.*)$/.exec(item);
  if (!m) throw new Error(`?set=${item}: expected name=value or name[index]=value`);
  const slot = g.a.varSlot(m[1]), v = literal(m[3]), vars = g.globalScope.vars;
  return () => {
    if (m[2] === undefined) return void vars.set(slot, v);
    const cur = vars.get(slot), a: GArray = Array.isArray(cur) ? cur.slice() : [];
    for (let i = a.length; i < +m[2]; i++) a[i] = 0; // GM fills skipped elements with 0
    a[+m[2]] = v;
    vars.set(slot, a);
  };
}

function caller(g: Game, item: string): () => void {
  const m = /^(\w+)(?:\((.*)\))?$/.exec(item);
  if (!m) throw new Error(`?call=${item}: expected fn or fn(arg, ...)`);
  const fn = g.a.functions.findIndex((f) => f.name === m[1]);
  if (fn < 0) throw new Error(`?call=${m[1]}: no such function`);
  const f = new GmMethod(fn, null, m[1]), args = split(m[2] ?? '').map(literal);
  return () => void g.vm.callValue(f, g.globalScope, args);
}

/** The ?set= / ?call= steps of a query (each may repeat or hold a comma list), or null if there are none. */
export function warpSetup(g: Game, q: URLSearchParams): (() => void) | null {
  const steps: (() => void)[] = [];
  for (const [k, v] of q) {
    if (k === 'set' || k === 'call') for (const item of split(v)) steps.push((k === 'set' ? setter : caller)(g, item));
  }
  return steps.length ? () => { for (const s of steps) s(); } : null;
}
