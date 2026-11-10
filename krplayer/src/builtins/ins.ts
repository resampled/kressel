// Instances (ins_*) and movement (mov_*).

import { define, family, n, b } from './registry.ts';
import { GmStruct, real, Unverified, type Value } from '../value.ts';
import { EV } from '../runtime/assets.ts';
import type { Game } from '../runtime/game.ts';
import { Instance } from '../runtime/instance.ts';
import type { PathDef } from '../runtime/paths.ts';

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
  // Outside 0-15 GM does nothing (HTML5 event_user; error_audit.md).
  if (k >= 0 && k <= 15 && g.self instanceof Instance) g.userEvent(g.self, k);
  return undefined;
});
define('ins_event_perform', (g, s, t) => { if (g.self instanceof Instance) g.performEvent(g.self, Math.trunc(n(s, t, 0)), Math.trunc(n(s, t, 1))); return undefined; });
define('ins_object_name', (g, s, t) => g.object(s[t]).name);
define('ins_object_sprite', (g, s, t) => g.object(s[t]).sprite?.index ?? -1);
define('ins_is_ancestor', (g, s, t) => { const c = g.object(s[t]); return c.isA.has(real(s[t - 1])) && c.index !== real(s[t - 1]); });

// ---------------------------------------------------------------- movement

const D2R = Math.PI / 180;
export const self = (g: Game): Instance => {
  if (!(g.self instanceof Instance)) throw new Unverified('this function needs an instance (self is a struct)');
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
define('mov_path_start', (g, s, t) => { g.paths.start(self(g), n(s, t, 0), n(s, t, 1), n(s, t, 2), b(s, t, 3)); return undefined; });
define('mov_path_end', (g) => { self(g).path = -1; return undefined; });
/*
 * GM never errors on a missing path (or point): edits do nothing and getters give the HTML5 runner's defaults
 * (error_audit.md).
 */
const path = (g: Game, s: Value[], t: number): PathDef | undefined => (g.paths.exists(n(s, t, 0)) ? g.paths.get(n(s, t, 0), 'path') : undefined);
/** Edits a path's control points or settings; its followed line is rebuilt on next use. */
const edit = (f: (p: PathDef, s: Value[], t: number) => void) => (g: Game, s: Value[], t: number) => { const p = path(g, s, t); if (p) { f(p, s, t); p.changed(); } return undefined; };
const get = (dflt: Value, f: (p: PathDef, s: Value[], t: number) => Value) => (g: Game, s: Value[], t: number) => { const p = path(g, s, t); return p ? f(p, s, t) : dflt; };
/** A control point's x/y/speed (axis 0-2), or 0 out of range. */
const point = (axis: number) => get(0, (p, s, t) => { const k = Math.trunc(n(s, t, 1)); return k >= 0 && k < p.count ? p.pts[k * 3 + axis] : 0; });
family('mov_path', 'path_', {
  add: (g) => g.paths.add(),
  delete: (g, s, t) => { g.paths.delete(n(s, t, 0)); return undefined; },
  exists: (g, s, t) => g.paths.exists(n(s, t, 0)),
  add_point: edit((p, s, t) => { p.pts.push(n(s, t, 1), n(s, t, 2), n(s, t, 3)); }),
  clear_points: edit((p) => { p.pts.length = 0; }),
  set_closed: edit((p, s, t) => { p.closed = b(s, t, 1); }),
  set_kind: edit((p, s, t) => { p.smooth = n(s, t, 1) === 1; }),
  set_precision: edit((p, s, t) => { p.precision = Math.max(1, Math.min(8, Math.trunc(n(s, t, 1)))); }),
  get_x: get(-1, (p, s, t) => p.at(n(s, t, 1), 0)),
  get_y: get(-1, (p, s, t) => p.at(n(s, t, 1), 1)),
  get_speed: get(-1, (p, s, t) => p.at(n(s, t, 1), 2)),
  get_length: get(0, (p) => p.length()),
  get_number: get(0, (p) => p.count),
  get_closed: get(true, (p) => p.closed),
  get_kind: get(0, (p) => (p.smooth ? 1 : 0)),
  get_precision: get(8, (p) => p.precision),
  get_point_x: point(0),
  get_point_y: point(1),
  get_point_speed: point(2),
});
// The functions below follow GM's HTML5 runner (Function_Instance.js, Function_Movement.js, Function_MotionPlanning.js).

/** instance_copy(performevent): the copy gets a new id; pre-create and create run on it when asked. */
define('ins_copy', (g, s, t) => {
  const src = self(g), i = g.create(src.obj, src.x, src.y, src.depth);
  i.copyFrom(src);
  if (b(s, t, 0)) g.runCreate(i);
  return i.id;
});
/**
 * instance_change(obj, perf): destroy + clean up events (if perf), then the instance takes the object's sprite, mask,
 * solid, visible and persistent (not its depth), then pre-create + create (if perf). A missing object is logged and ignored.
 */
define('ins_change', (g, s, t) => {
  const i = self(g), o = g.a.objects[real(s[t])], perf = b(s, t, 1);
  if (!o) { g.p.log(`instance_change: object ${String(s[t])} does not exist`); return undefined; }
  if (perf) { g.event(i, EV.destroy, null); g.event(i, EV.cleanup, null); }
  i.obj = o; i.sprite = o.sprite; i.mask = o.mask; i.solid = o.solid; i.visible = o.visible; i.persistent = o.persistent;
  if (perf) g.runCreate(i);
  return undefined;
});

/** place_free (solid instances only) or, with all, place_empty. */
const free = (g: Game, i: Instance, x: number, y: number, all: boolean): boolean => g.placeMeeting(i, x, y, -3, !all) === null;
const dirTo = (x1: number, y1: number, x2: number, y2: number) => ((Math.atan2(y1 - y2, x2 - x1) / D2R) + 360) % 360;

/** move_bounce_solid / _all(advanced). Advanced sweeps 10 degree steps either side of the heading for the free arc and reflects about it. */
define('mov_bounce', (g, s, t) => {
  const i = self(g), all = s[t] === 'all';
  let bounced = false;
  if (!free(g, i, i.x, i.y, all)) { i.x = i.xprevious; i.y = i.yprevious; bounced = true; }
  if (b(s, t, 1)) {
    const dir = 10 * Math.round(i.direction / 10), x = i.x, y = i.y, sp = i.speed;
    let l = dir, r = dir;
    for (let k = 1; k < 36; k++) { l -= 10; if (free(g, i, x + sp * Math.cos(l * D2R), y - sp * Math.sin(l * D2R), all)) break; bounced = true; }
    for (let k = 1; k < 36; k++) { r += 10; if (free(g, i, x + sp * Math.cos(r * D2R), y - sp * Math.sin(r * D2R), all)) break; bounced = true; }
    if (bounced) i.setDirection(180 + l + r - dir);
    return undefined;
  }
  const h = free(g, i, i.x + i.hspeed, i.y, all), v = free(g, i, i.x, i.y + i.vspeed, all), d = free(g, i, i.x + i.hspeed, i.y + i.vspeed, all);
  if ((!h && !v) || (h && v && !d)) i.setHV(-i.hspeed, -i.vspeed); else if (!h) i.setHV(-i.hspeed, i.vspeed); else if (!v) i.setHV(i.hspeed, -i.vspeed);
  return undefined;
});
/** Steps of one pixel along dir: maxdist rounded, or 1000 when it's 0 or less. */
const steps = (maxdist: number) => (maxdist <= 0 ? 1000 : Math.round(maxdist));
/** move_contact_solid / _all(dir, maxdist): moves while the next pixel is free; does nothing if already colliding. */
define('mov_contact', (g, s, t) => {
  const i = self(g), all = s[t] === 'all', dx = Math.cos(n(s, t, 1) * D2R), dy = -Math.sin(n(s, t, 1) * D2R);
  if (!free(g, i, i.x, i.y, all)) return undefined;
  for (let k = steps(n(s, t, 2)); k > 0 && free(g, i, i.x + dx, i.y + dy, all); k--) { i.x += dx; i.y += dy; }
  return undefined;
});
/** move_outside_solid / _all(dir, maxdist): moves until free; stays where it got to if it never is. */
define('mov_outside', (g, s, t) => {
  const i = self(g), all = s[t] === 'all', dx = Math.cos(n(s, t, 1) * D2R), dy = -Math.sin(n(s, t, 1) * D2R);
  for (let k = steps(n(s, t, 2)); k > 0 && !free(g, i, i.x, i.y, all); k--) { i.x += dx; i.y += dy; }
  return undefined;
});
define('mov_is_snapped', (g, s, t) => {
  const i = self(g), h = n(s, t, 0), v = n(s, t, 1);
  return !(h > 0 && Math.abs(i.x - h * Math.round(i.x / h)) >= 0.001) && !(v > 0 && Math.abs(i.y - v * Math.round(i.y / v)) >= 0.001);
});
/** mp_linear_step(x, y, stepsize, checkall): one straight step if it's free. Returns whether the goal is within reach (even if blocked). */
define('mov_mp_linear_step', (g, s, t) => {
  const i = self(g), x = n(s, t, 0), y = n(s, t, 1), step = n(s, t, 2), all = b(s, t, 3);
  if (i.x === x && i.y === y) return true;
  const dist = Math.hypot(i.x - x, i.y - y), near = dist <= step;
  const nx = near ? x : i.x + step * (x - i.x) / dist, ny = near ? y : i.y + step * (y - i.y) / dist;
  if (free(g, i, nx, ny, all)) { i.setDirection(dirTo(i.x, i.y, nx, ny)); i.x = nx; i.y = ny; }
  return near;
});
// mp_potential_settings defaults: turn at most 30 degrees a step, try every 10 degrees, look 3 steps ahead, rotate on the spot when stuck.
const POT_MAXROT = 30, POT_STEP = 10, POT_AHEAD = 3;
/** Takes a step in direction dir if it's within the turn limit and both the look-ahead and the next position are free. */
function tryDir(g: Game, i: Instance, dir: number, step: number, all: boolean): boolean {
  const diff = Math.abs(((((dir - i.direction) % 360) + 540) % 360) - 180), c = Math.cos(dir * D2R), sn = Math.sin(dir * D2R);
  if (diff > POT_MAXROT || !free(g, i, i.x + step * POT_AHEAD * c, i.y - step * POT_AHEAD * sn, all) || !free(g, i, i.x + step * c, i.y - step * sn, all)) return false;
  i.setDirection(dir); i.x += step * c; i.y -= step * sn;
  return true;
}
/** mp_potential_step(x, y, stepsize, checkall): a step towards the goal, steering round obstacles. Returns whether the goal is within reach. */
define('mov_mp_potential_step', (g, s, t) => {
  const i = self(g), x = n(s, t, 0), y = n(s, t, 1), step = n(s, t, 2), all = b(s, t, 3);
  if (i.x === x && i.y === y) return true;
  if (Math.hypot(i.x - x, i.y - y) <= step) {
    if (free(g, i, x, y, all)) { i.setDirection(dirTo(i.x, i.y, x, y)); i.x = x; i.y = y; }
    return true;
  }
  const goal = dirTo(i.x, i.y, x, y);
  for (let d = 0; d < 180; d += POT_STEP) if (tryDir(g, i, goal - d, step, all) || tryDir(g, i, goal + d, step, all)) return false;
  i.setDirection(i.direction + POT_MAXROT);
  return false;
});

/** instance_id_get(n): the nth active instance, in instance order (GM's instance_id[n]). */
define('ins_id_get', (g, s, t) => {
  let k = Math.trunc(n(s, t, 0));
  if (k >= 0) for (const i of g.instances) if (i.alive && i.active && k-- === 0) return i.id;
  return -4;
});
