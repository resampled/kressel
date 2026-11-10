// Variables (functions): arrays, structs, variable_* and method (var_*).

import { define, n, str } from './registry.ts';
import { compare, equals, GmlError, GmMethod, GmStruct, NotImplemented, real, Scope, truthy, Unverified, type GArray, type Value } from '../value.ts';
import { IV_NAMES } from '../compile/names.ts';
import { Instance, NOI } from '../runtime/instance.ts';
import type { Game } from '../runtime/game.ts';

const arr = (v: Value, fn: string): GArray => {
  if (!Array.isArray(v)) throw new Unverified(`${fn}: argument is not an array`);
  return v;
};

define('var_arr_length', (_g, s, t) => arr(s[t], 'array_length').length);
define('var_arr_get', (_g, s, t) => {
  const a = arr(s[t], 'array_get'), i = Math.trunc(n(s, t, 1));
  if (i < 0 || i >= a.length) throw new GmlError(`array_get: index ${i} out of range (length ${a.length})`);
  return a[i];
});
/** Pre-2.3 2D helpers: height is the outer length, length_2d a row's length (0 if that row isn't an array). */
define('var_arr_2d', (_g, s, t) => {
  const a = s[t - 1];
  if (!Array.isArray(a)) return 0;
  if (s[t] === 'height') return a.length;
  const row = a[Math.trunc(n(s, t, 2))];
  return Array.isArray(row) ? row.length : 0;
});
define('var_arr_create', (_g, s, t, argc) => {
  const k = Math.trunc(n(s, t, 0)), v = argc > 1 ? s[t - 1] : 0;
  if (k < 0 || k > 1 << 26) throw new Unverified(`array_create: bad size ${k}`);
  return new Array(k).fill(v);
});
define('var_arr_push', (_g, s, t, argc) => { const a = arr(s[t], 'array_push'); for (let k = 1; k < argc; k++) a.push(s[t - k]); return undefined; });
define('var_arr_take', (_g, s, t) => { const a = arr(s[t - 1], 'array_pop'); return s[t] === 'last' ? a.pop() : a.shift(); });
define('var_arr_insert', (_g, s, t, argc) => {
  const a = arr(s[t], 'array_insert'), i = Math.trunc(n(s, t, 1)), xs: Value[] = [];
  for (let k = 2; k < argc; k++) xs.push(s[t - k]);
  while (a.length < i) a.push(0);
  a.splice(i, 0, ...xs);
  return undefined;
});
define('var_arr_delete', (_g, s, t) => { arr(s[t], 'array_delete').splice(Math.trunc(n(s, t, 1)), Math.trunc(n(s, t, 2))); return undefined; });
define('var_arr_resize', (_g, s, t) => {
  const a = arr(s[t], 'array_resize'), k = Math.trunc(n(s, t, 1));
  if (k < a.length) a.length = k; else while (a.length < k) a.push(0);
  return undefined;
});
/**
 * array_foreach / map / filter / find_index / any / all (array, callback(element, index), [offset, length]).
 * A negative offset counts from the end; a negative length walks backwards from the offset.
 */
define('var_arr_iterate', (g, s, t, argc) => {
  const fn = String(s[t]), a = arr(s[t - 1], `array_${fn}`), f = s[t - 2], out: GArray = [], args: Value[] = [0, 0];
  let i = argc > 3 ? Math.trunc(n(s, t, 3)) : 0, len = argc > 4 ? Math.trunc(n(s, t, 4)) : a.length;
  if (i < 0) i = Math.max(0, a.length + i);
  const step = len < 0 ? -1 : 1;
  for (len = Math.abs(len); len > 0 && i >= 0 && i < a.length; len--, i += step) {
    args[0] = a[i]; args[1] = i;
    const r = g.vm.callValue(f, g.self, args);
    switch (fn) {
      case 'foreach': break;
      case 'map': out.push(r); break;
      case 'filter': if (truthy(r)) out.push(a[i]); break;
      case 'find_index': if (truthy(r)) return i; break;
      case 'any': if (truthy(r)) return true; break;
      case 'all': if (!truthy(r)) return false; break;
      default: throw new NotImplemented(`array_${fn} is not implemented in krplayer yet`);
    }
  }
  return fn === 'map' || fn === 'filter' ? out : fn === 'find_index' ? -1 : fn === 'any' ? false : fn === 'all' ? true : undefined;
});
define('var_arr_contains', (_g, s, t) => arr(s[t], 'array_contains').some((x) => equals(x, s[t - 1])));
define('var_arr_index_of', (_g, s, t) => arr(s[t], 'array_get_index').findIndex((x) => equals(x, s[t - 1])));
define('var_arr_reverse', (_g, s, t) => arr(s[t], 'array_reverse').slice().reverse());
define('var_arr_concat', (_g, s, t, argc) => { const out: GArray = []; for (let k = 0; k < argc; k++) out.push(...arr(s[t - k], 'array_concat')); return out; });
define('var_arr_copy', (_g, s, t) => {
  const dst = arr(s[t], 'array_copy'), di = Math.trunc(n(s, t, 1)), src = arr(s[t - 2], 'array_copy'), si = Math.trunc(n(s, t, 3)), len = Math.trunc(n(s, t, 4));
  const part = src.slice(si, si + len);
  while (dst.length < di) dst.push(0);
  for (let k = 0; k < part.length; k++) dst[di + k] = part[k];
  return undefined;
});
define('var_arr_sort', (g, s, t) => {
  const a = arr(s[t], 'array_sort'), o = s[t - 1];
  if (typeof o === 'boolean' || typeof o === 'number') a.sort((x, y) => (truthy(o) ? compare(x, y) : compare(y, x)));
  else a.sort((x, y) => real(g.vm.callValue(o, g.self, [x, y])));
  return undefined;
});

// ---------------------------------------------------------------- structs and variables

const struct = (v: Value, fn: string): Scope => {
  if (v instanceof Scope) return v;
  throw new Unverified(`${fn}: argument is not a struct`);
};
define('var_struct_get', (g, s, t) => struct(s[t], 'struct_get').vars.get(g.a.varSlot(str(s, t, 1))));
define('var_struct_set', (g, s, t) => { struct(s[t], 'struct_set').vars.set(g.a.varSlot(str(s, t, 1)), s[t - 2]); return undefined; });
define('var_struct_exists', (g, s, t) => s[t] instanceof Scope && s[t].vars.has(g.a.varSlot(str(s, t, 1))));
define('var_struct_remove', (g, s, t) => { struct(s[t], 'struct_remove').vars.delete(g.a.varSlot(str(s, t, 1))); return undefined; });
define('var_struct_keys', (g, s, t) => [...struct(s[t], 'struct_get_names').vars.keys()].map((k) => g.a.varNames[k]));

/** An instance's variable by name: built-ins too (variable_instance_get(id, "x")). */
function instVar(g: Game, v: Value, name: string): { inst: Instance; iv: number | undefined; slot: number } {
  const sc = g.vm.scopeOf(v);
  if (!(sc instanceof Instance)) throw new Unverified('variable_instance_*: not an instance');
  return { inst: sc, iv: IV_NAMES.get(name), slot: g.a.varSlot(name) };
}
define('var_inst_get', (g, s, t) => {
  const { inst, iv, slot } = instVar(g, s[t], str(s, t, 1));
  return iv !== undefined ? g.getIV(inst, iv, NOI) : inst.vars.get(slot);
});
define('var_inst_set', (g, s, t) => {
  const { inst, iv, slot } = instVar(g, s[t], str(s, t, 1));
  if (iv !== undefined) g.setIV(inst, iv, s[t - 2], NOI); else inst.vars.set(slot, s[t - 2]);
  return undefined;
});
define('var_inst_exists', (g, s, t) => {
  const inst = g.first(real(s[t]));
  if (!inst) return false;
  const name = str(s, t, 1);
  return IV_NAMES.has(name) || inst.vars.has(g.a.varSlot(name));
});
define('var_inst_names', (g, s, t) => {
  const inst = g.first(real(s[t]));
  if (!inst) throw new Unverified(`variable_instance_get_names: instance ${String(s[t])} does not exist`);
  return [...inst.vars.keys()].map((k) => g.a.varNames[k]);
});
define('var_global_get', (g, s, t) => g.globalScope.vars.get(g.a.varSlot(str(s, t, 0))));
define('var_global_set', (g, s, t) => { g.globalScope.vars.set(g.a.varSlot(str(s, t, 0)), s[t - 1]); return undefined; });
define('var_global_exists', (g, s, t) => g.globalScope.vars.has(g.a.varSlot(str(s, t, 0))));

/** method(context, f): -1/self binds to self; undefined leaves it unbound; an id or struct binds to that. */
define('var_method', (g, s, t) => {
  const ctx = s[t], f = s[t - 1];
  const fn = f instanceof GmMethod ? f.fn : typeof f === 'number' ? g.scriptFunction(f) : -1;
  if (fn < 0) throw new Unverified('method: not a function');
  const self = ctx === undefined ? null : ctx instanceof Scope ? ctx : real(ctx) === -1 ? g.self : g.vm.scopeOf(ctx);
  return new GmMethod(fn, self, g.a.functions[fn].name);
});
define('var_method_self', (g, s, t) => {
  const m = s[t];
  if (!(m instanceof GmMethod)) return undefined;
  return m.self instanceof Instance ? m.self.id : m.self instanceof GmStruct ? m.self : undefined;
});
