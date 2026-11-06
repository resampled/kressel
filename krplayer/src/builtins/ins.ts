// Instances (ins_*) and movement (mov_*).

import { define, n, b } from './registry.ts';
import { GmlError, GmStruct, real, type Value } from '../value.ts';
import { EV } from '../runtime/assets.ts';
import type { Game } from '../runtime/game.ts';
import { Instance } from '../runtime/instance.ts';

/** instance_create_*'s optional struct: its fields are set before the create event runs. */
function spawnWith(g: Game, obj: Value, x: number, y: number, depth: number, layer: number, vars: Value): number {
  const o = g.object(obj);
  if (!(vars instanceof GmStruct)) return g.spawn(o, x, y, depth, layer).id;
  const inst = g.create(o, x, y, depth);
  inst.layer = layer;
  for (const [k, v] of vars.vars) inst.vars.set(k, v);
  g.runCreate(inst);
  return inst.id;
}

define('ins_create_layer', (g, s, t, argc) => {
  const l = g.layers.get(s[t - 2] as number | string);
  return spawnWith(g, s[t - 3], n(s, t, 0), n(s, t, 1), l.depth, l.id, argc > 4 ? s[t - 4] : undefined);
});
define('ins_create_depth', (g, s, t, argc) => spawnWith(g, s[t - 3], n(s, t, 0), n(s, t, 1), n(s, t, 2), -1, argc > 4 ? s[t - 4] : undefined));

/** Instances a target value names: an id, an object (all of its instances), all, self/other. */
export function targets(g: Game, v: Value, out: Instance[]): Instance[] {
  out.length = 0;
  const t = real(v);
  if (t >= 100000 || t === -1 || t === -2) { const i = g.first(t); if (i) out.push(i); return out; }
  for (const inst of g.instances) if (inst.alive && inst.active && (t === -3 || inst.obj.isA.has(t))) out.push(inst);
  return out;
}
const scratch: Instance[] = [];

define('ins_destroy', (g, s, t, argc) => {
  const run = argc < 2 || b(s, t, 1);
  if (argc === 0) { if (g.self instanceof Instance) g.destroy(g.self, run); return undefined; }
  for (const inst of [...targets(g, s[t], scratch)]) g.destroy(inst, run);
  return undefined;
});
define('ins_exists', (g, s, t) => g.count(real(s[t])) > 0);
define('ins_number', (g, s, t) => g.count(real(s[t])));
define('ins_find', (g, s, t) => {
  const k = Math.trunc(n(s, t, 1)), list = targets(g, s[t], scratch);
  return list[k]?.id ?? -4;
});
function nearest(g: Game, s: Value[], t: number, far: boolean): number {
  const x = n(s, t, 0), y = n(s, t, 1);
  let best: Instance | null = null, bd = far ? -1 : Infinity;
  for (const i of targets(g, s[t - 2], scratch)) {
    const d = Math.hypot(i.x - x, i.y - y);
    if (far ? d > bd : d < bd) { bd = d; best = i; }
  }
  return best?.id ?? -4;
}
define('ins_nearest', (g, s, t) => nearest(g, s, t, false));
define('ins_furthest', (g, s, t) => nearest(g, s, t, true));

define('ins_set_active_all', (g, s, t, argc) => {
  const on = s[t] === 'activate', notme = !on && argc > 1 && b(s, t, 1);
  for (const inst of g.instances) if (inst.alive && !(notme && inst === g.self)) inst.active = on;
  return undefined;
});
define('ins_set_active_object', (g, s, t) => {
  const on = s[t] === 'activate', v = real(s[t - 1]);
  for (const inst of g.instances) {
    if (!inst.alive) continue;
    if (v >= 100000 ? inst.id === v : v === -3 || inst.obj.isA.has(v)) inst.active = on;
  }
  return undefined;
});

define('ins_event_inherited', (g) => { g.inherited(); return undefined; });
define('ins_event_user', (g, s, t) => {
  const k = Math.trunc(n(s, t, 0));
  if (k < 0 || k > 15) throw new GmlError(`event_user(${k}): user events are 0-15`);
  if (g.self instanceof Instance) g.userEvent(g.self, k);
  return undefined;
});
define('ins_object_name', (g, s, t) => g.object(s[t]).name);
define('ins_object_sprite', (g, s, t) => g.object(s[t]).sprite?.index ?? -1);
define('ins_is_ancestor', (g, s, t) => { const c = g.object(s[t]); return c.isA.has(real(s[t - 1])) && c.index !== real(s[t - 1]); });

// ---------------------------------------------------------------- movement

const D2R = Math.PI / 180;
export const self = (g: Game): Instance => {
  if (!(g.self instanceof Instance)) throw new GmlError('this function needs an instance (self is a struct)');
  return g.self;
};

define('mov_motion_set', (g, s, t) => { const i = self(g); i.setDirection(n(s, t, 0)); i.setSpeed(n(s, t, 1)); return undefined; });
/** GMS1 D&D move: 9 flags in numpad order (1 = down-left ... 5 = stop ... 9 = up-right); one set flag is picked at random. */
const ACTION_DIRS = [225, 270, 315, 180, -1, 0, 135, 90, 45];
define('mov_action_move', (g, s, t) => {
  const flags = String(s[t]), on = ACTION_DIRS.filter((_, k) => flags[k] === '1');
  if (!on.length) return undefined;
  const d = on[Math.floor(g.random() * on.length)], i = self(g);
  if (d < 0) i.setSpeed(0); else { i.setDirection(d); i.setSpeed(n(s, t, 1)); }
  return undefined;
});
define('mov_motion_add', (g, s, t) => {
  const i = self(g), d = n(s, t, 0) * D2R, v = n(s, t, 1);
  i.setHV(i.hspeed + v * Math.cos(d), i.vspeed - v * Math.sin(d));
  return undefined;
});
define('mov_towards_point', (g, s, t) => {
  const i = self(g), x = n(s, t, 0), y = n(s, t, 1);
  i.direction = ((Math.atan2(-(y - i.y), x - i.x) / D2R) + 360) % 360;
  i.setSpeed(n(s, t, 2));
  return undefined;
});
define('mov_snap', (g, s, t) => {
  const i = self(g), h = n(s, t, 0), v = n(s, t, 1);
  if (h > 0) i.x = Math.round(i.x / h) * h;
  if (v > 0) i.y = Math.round(i.y / v) * v;
  return undefined;
});
define('mov_wrap', (g, s, t) => {
  const i = self(g), m = n(s, t, 2), w = g.room.width, h = g.room.height;
  if (b(s, t, 0)) { if (i.x >= w + m) i.x -= w + 2 * m; else if (i.x < -m) i.x += w + 2 * m; }
  if (b(s, t, 1)) { if (i.y >= h + m) i.y -= h + 2 * m; else if (i.y < -m) i.y += h + 2 * m; }
  return undefined;
});
// The project has no paths (the PATH chunk is empty), so a path can never be started.
define('mov_path_start', (_g, s, t) => { throw new GmlError(`path ${String(s[t])} does not exist`); });
define('mov_path_end', (g) => { self(g).path = -1; return undefined; });
/** instance_id_get(n): the nth active instance, in instance order (GM's instance_id[n]). */
define('ins_id_get', (g, s, t) => {
  let k = Math.trunc(n(s, t, 0));
  if (k >= 0) for (const i of g.instances) if (i.alive && i.active && k-- === 0) return i.id;
  return -4;
});
