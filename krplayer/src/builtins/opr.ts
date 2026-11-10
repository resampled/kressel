// Operators (functions): math, randomness, strings and type checks (opr_*).

import { define, n, str } from './registry.ts';
import { GmlError, GmMethod, GmStruct, real, str as toStr, typeName, NotImplemented, Unverified, type Value } from '../value.ts';
import type { Game } from '../runtime/game.ts';

const D2R = Math.PI / 180;

/** GM's round(): halves go to the even neighbour. */
function rint(x: number): number {
  const f = Math.floor(x), d = x - f;
  return d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
}

const MATH: Record<string, (x: number) => number> = {
  abs: Math.abs, sign: Math.sign, round: rint, floor: Math.floor, ceil: Math.ceil, frac: (x) => x - Math.trunc(x),
  sqrt: (x) => { if (x < 0) throw new GmlError(`sqrt of negative number ${x}`); return Math.sqrt(x); },
  sqr: (x) => x * x, exp: Math.exp, ln: Math.log, log2: Math.log2, log10: Math.log10,
};
define('opr_mathop', (_g, s, t) => {
  const f = MATH[s[t] as string];
  if (!f) throw new NotImplemented(`unknown math function ${String(s[t])}`);
  return f(n(s, t, 1));
});
const TRIG: Record<string, (x: number) => number> = { sin: Math.sin, cos: Math.cos, tan: Math.tan, arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan };
define('opr_trig', (_g, s, t) => TRIG[s[t] as string](n(s, t, 1)));
define('opr_dtrig', (_g, s, t) => {
  const v = n(s, t, 1), f = s[t] as string;
  if (f.startsWith('arc')) return TRIG[f](v) / D2R;
  // GM snaps the classic angles to exact values (dsin(180) is 0, not 1.2e-16).
  const a = ((v % 360) + 360) % 360;
  if (f === 'sin' && a % 180 === 0) return 0;
  if (f === 'cos' && (a === 90 || a === 270)) return 0;
  return TRIG[f](v * D2R);
});
define('opr_atan2', (_g, s, t) => { const r = Math.atan2(n(s, t, 1), n(s, t, 2)); return s[t] === 'deg' ? r / D2R : r; });
define('opr_convert_angle', (_g, s, t) => (s[t] === 'deg_to_rad' ? n(s, t, 1) * D2R : n(s, t, 1) / D2R));
define('opr_power', (_g, s, t) => (s[t] === 'power' ? Math.pow(n(s, t, 1), n(s, t, 2)) : Math.log(n(s, t, 2)) / Math.log(n(s, t, 1))));
define('opr_aggregate', (_g, s, t, argc) => {
  const xs: number[] = [];
  for (let k = 1; k < argc; k++) xs.push(n(s, t, k));
  if (!xs.length) return 0;
  switch (s[t]) {
    case 'min': return Math.min(...xs);
    case 'max': return Math.max(...xs);
    case 'mean': return xs.reduce((a, b) => a + b, 0) / xs.length;
    case 'median': { xs.sort((a, b) => a - b); return xs[Math.floor(xs.length / 2)]; }
  }
  throw new NotImplemented(`unknown aggregate ${String(s[t])}`);
});
define('opr_clamp', (_g, s, t) => Math.min(Math.max(n(s, t, 0), n(s, t, 1)), n(s, t, 2)));
define('opr_lerp', (_g, s, t) => { const a = n(s, t, 0); return a + (n(s, t, 1) - a) * n(s, t, 2); });
define('opr_point_direction', (_g, s, t) => {
  const dx = n(s, t, 2) - n(s, t, 0), dy = n(s, t, 3) - n(s, t, 1);
  return ((Math.atan2(-dy, dx) / D2R) + 360) % 360;
});
define('opr_point_distance', (_g, s, t) => Math.hypot(n(s, t, 2) - n(s, t, 0), n(s, t, 3) - n(s, t, 1)));
define('opr_lengthdir', (_g, s, t) => {
  const l = n(s, t, 1), d = n(s, t, 2) * D2R;
  return s[t] === 'x' ? l * Math.cos(d) : -l * Math.sin(d);
});
define('opr_angle_difference', (_g, s, t) => ((((n(s, t, 0) - n(s, t, 1)) % 360) + 540) % 360) - 180);
define('opr_point_in_rect', (_g, s, t) => {
  const px = n(s, t, 0), py = n(s, t, 1);
  return px >= n(s, t, 2) && px <= n(s, t, 4) && py >= n(s, t, 3) && py <= n(s, t, 5);
});
/** rectangle_in_rectangle(source, destination): 1 source inside destination, 2 overlapping, 0 apart (edges inclusive; corners in any order). */
define('opr_rect_in_rect', (_g, s, t) => {
  const lo = (i: number, j: number) => Math.min(n(s, t, i), n(s, t, j)), hi = (i: number, j: number) => Math.max(n(s, t, i), n(s, t, j));
  const sl = lo(0, 2), st = lo(1, 3), sr = hi(0, 2), sb = hi(1, 3), dl = lo(4, 6), dt = lo(5, 7), dr = hi(4, 6), db = hi(5, 7);
  if (sl >= dl && sr <= dr && st >= dt && sb <= db) return 1;
  return sl <= dr && sr >= dl && st <= db && sb >= dt ? 2 : 0;
});
define('opr_point_in_circle', (_g, s, t) => Math.hypot(n(s, t, 0) - n(s, t, 2), n(s, t, 1) - n(s, t, 3)) <= n(s, t, 4));

// ---------------------------------------------------------------- random

define('opr_random', (g, s, t) => g.random() * n(s, t, 0));
define('opr_random_range', (g, s, t) => { const a = n(s, t, 0); return a + g.random() * (n(s, t, 1) - a); });
define('opr_irandom', (g, s, t) => Math.floor(g.random() * (Math.floor(n(s, t, 0)) + 1)));
define('opr_irandom_range', (g, s, t) => {
  const a = Math.floor(n(s, t, 0)), b = Math.floor(n(s, t, 1)), lo = Math.min(a, b);
  return lo + Math.floor(g.random() * (Math.abs(b - a) + 1));
});
define('opr_choose', (g, s, t, argc) => s[t - Math.floor(g.random() * argc)]);
define('opr_randomize', (g) => { g.rng.set(Math.floor(Math.random() * 0x7fffffff)); return g.rng.seed; });
define('opr_seed_set', (g, s, t) => { g.rng.set(n(s, t, 0)); return undefined; });
define('opr_seed_get', (g) => g.rng.seed);

// ---------------------------------------------------------------- strings

export const gstr = (g: Game, v: Value) => toStr(v, (k) => g.a.varNames[k]);

define('opr_string', (g, s, t) => gstr(g, s[t]));
define('opr_real', (_g, s, t) => {
  const v = s[t];
  if (typeof v !== 'string') return real(v);
  const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i.exec(v);
  if (!m) throw new GmlError(`unable to convert string "${v}" to a number`);
  return Number(v);
});
define('opr_str_length', (_g, s, t) => str(s, t, 0).length);
define('opr_str_byte_length', (_g, s, t) => new TextEncoder().encode(str(s, t, 0)).length);
define('opr_str_char_at', (_g, s, t) => { const x = str(s, t, 0), i = Math.trunc(n(s, t, 1)); return i >= 1 && i <= x.length ? x[i - 1] : ''; });
define('opr_str_copy', (_g, s, t) => {
  const x = str(s, t, 0), i = Math.max(1, Math.trunc(n(s, t, 1))), c = Math.trunc(n(s, t, 2));
  return c <= 0 ? '' : x.substr(i - 1, c);
});
define('opr_str_pos', (_g, s, t) => str(s, t, 1).indexOf(str(s, t, 0)) + 1);
define('opr_str_count', (_g, s, t) => { const sub = str(s, t, 0); return sub ? str(s, t, 1).split(sub).length - 1 : 0; });
define('opr_str_insert', (_g, s, t) => {
  const sub = str(s, t, 0), x = str(s, t, 1), p = Math.min(Math.max(1, Math.trunc(n(s, t, 2))), x.length + 1);
  return x.slice(0, p - 1) + sub + x.slice(p - 1);
});
define('opr_str_delete', (_g, s, t) => {
  const x = str(s, t, 0), p = Math.trunc(n(s, t, 1)), c = Math.trunc(n(s, t, 2));
  if (p < 1 || c <= 0) return x;
  return x.slice(0, p - 1) + x.slice(p - 1 + c);
});
define('opr_str_replace', (_g, s, t) => {
  const x = str(s, t, 1), sub = str(s, t, 2), rep = str(s, t, 3);
  if (!sub) return x;
  return s[t] === 'all' ? x.split(sub).join(rep) : x.replace(sub, () => rep);
});
define('opr_str_case', (_g, s, t) => (s[t] === 'upper' ? str(s, t, 1).toUpperCase() : str(s, t, 1).toLowerCase()));
define('opr_str_repeat', (_g, s, t) => str(s, t, 0).repeat(Math.max(0, Math.trunc(n(s, t, 1)))));
define('opr_str_filter', (_g, s, t) => {
  const x = str(s, t, 1), re = s[t] === 'digits' ? /[0-9]/ : s[t] === 'letters' ? /[A-Za-z]/ : /[A-Za-z0-9]/;
  return [...x].filter((c) => re.test(c)).join('');
});
define('opr_str_trim', (_g, s, t) => { const x = str(s, t, 1); return s[t] === 'start' ? x.trimStart() : s[t] === 'end' ? x.trimEnd() : x.trim(); });
define('opr_str_affix', (_g, s, t) => (s[t] === 'start' ? str(s, t, 1).startsWith(str(s, t, 2)) : str(s, t, 1).endsWith(str(s, t, 2))));
define('opr_str_split', (_g, s, t, argc) => {
  let parts = str(s, t, 0).split(str(s, t, 1));
  if (argc > 2 && real(s[t - 2]) > 0.5) parts = parts.filter((p) => p !== '');
  return parts;
});
define('opr_str_join', (g, s, t, argc) => { const xs: string[] = []; for (let k = 1; k < argc; k++) xs.push(gstr(g, s[t - k])); return xs.join(str(s, t, 0)); });
define('opr_str_join_ext', (g, s, t) => { const a = s[t - 1]; if (!Array.isArray(a)) throw new Unverified('string_join_ext needs an array'); return a.map((v) => gstr(g, v)).join(str(s, t, 0)); });
define('opr_str_format', (_g, s, t) => {
  const v = n(s, t, 0), tot = Math.trunc(n(s, t, 1)), dec = Math.max(0, Math.trunc(n(s, t, 2)));
  const x = v.toFixed(dec);
  return x.padStart(tot + (dec > 0 ? dec + 1 : 0), ' ');
});
define('opr_charcode', (_g, s, t) => {
  if (s[t] === 'chr') return String.fromCodePoint(Math.max(0, Math.trunc(n(s, t, 1))));
  const x = str(s, t, 1);
  return x.length ? x.codePointAt(0)! : 0;
});
// "#" was GMS1's newline; "\#" stays a literal "#".
define('opr_str_hash_newline', (_g, s, t) => str(s, t, 0).replace(/\\#|#/g, (m) => (m === '#' ? '\n' : '#')));

// ---------------------------------------------------------------- types

const IS: Record<string, (v: Value) => boolean> = {
  real: (v) => typeof v === 'number', string: (v) => typeof v === 'string', array: (v) => Array.isArray(v),
  struct: (v) => v instanceof GmStruct, undefined: (v) => v === undefined, bool: (v) => typeof v === 'boolean',
  method: (v) => v instanceof GmMethod, numeric: (v) => typeof v === 'number' || typeof v === 'boolean',
  int64: () => false, int32: () => false, ptr: () => false,
};
define('opr_is_type', (_g, s, t) => {
  const f = IS[s[t] as string];
  if (!f) throw new NotImplemented(`unknown type check is_${String(s[t])}`);
  return f(s[t - 1]);
});
define('opr_typeof', (_g, s, t) => typeName(s[t]));
define('opr_convert', (_g, s, t) => (s[t] === 'bool' ? real(s[t - 1]) > 0.5 : Math.trunc(real(s[t - 1]))));
