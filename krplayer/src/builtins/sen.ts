// Sensing (sen_*): input and collisions.

import { define, n, str } from './registry.ts';
import { real, type Value } from '../value.ts';
import { keyState, type Game } from '../runtime/game.ts';
import { shape } from '../runtime/collision.ts';
import { Instance } from '../runtime/instance.ts';
import { self } from './ins.ts';

define('sen_key_held', (g, s, t) => keyState(g.p.input.keys, n(s, t, 0)));
define('sen_key_direct', (g, s, t) => keyState(g.p.input.keys, n(s, t, 0)));
define('sen_key_pressed', (g, s, t) => keyState(g.p.input.pressed, n(s, t, 0)));
define('sen_key_released', (g, s, t) => keyState(g.p.input.released, n(s, t, 0)));
define('sen_key_clear', (g, s, t) => { const k = n(s, t, 0), i = g.p.input; i.keys[k] = 0; i.pressed[k] = 0; i.released[k] = 0; return undefined; });
define('sen_io_clear', (g) => { const i = g.p.input; i.keys.fill(0); i.pressed.fill(0); i.released.fill(0); return undefined; });
define('sen_mouse_held', (g, s, t) => (g.p.input.mouseButtons & (1 << (n(s, t, 0) - 1))) !== 0);
const mbit = (s: Value[], t: number) => { const b = n(s, t, 0); return b === -1 ? 7 : b > 0 ? 1 << (b - 1) : 0; };
define('sen_mouse_pressed', (g, s, t) => (g.p.input.mousePressed & mbit(s, t)) !== 0);
define('sen_mouse_released', (g, s, t) => (g.p.input.mouseReleased & mbit(s, t)) !== 0);
define('sen_mouse_wheel', (g, s, t) => (s[t] === 'up' ? g.p.input.wheel > 0 : g.p.input.wheel < 0));
// No gamepads in the browser build yet: none connected (games fall back to the keyboard).
define('sen_gamepad_connected', () => false);
define('sen_gamepad_button', () => false);
define('sen_gamepad_axis', () => 0);
define('sen_gamepad_count', () => 0);
define('sen_gamepad_button_count', () => 0);
define('sen_gamepad_info', () => '');
define('sen_gamepad_test_mapping', () => undefined);
/** get_string / get_integer: the platform's blocking prompt; cancelled (or unparseable) gives the default. */
define('sen_ask', (g, s, t) => {
  const def = s[t - 2], ans = g.p.ask ? g.p.ask(str(s, t, 1), str(s, t, 2)) : null;
  if (s[t] === 'string') return ans ?? str(s, t, 2);
  const v = ans === null || ans.trim() === '' ? NaN : Number(ans);
  return Number.isFinite(v) ? v : real(def);
});
define('sen_clipboard', () => '');
define('sen_clipboard_set', () => undefined);

// ---------------------------------------------------------------- collisions

define('sen_place_meeting', (g, s, t) => g.placeMeeting(self(g), n(s, t, 0), n(s, t, 1), real(s[t - 2])) !== null);
define('sen_instance_place', (g, s, t) => g.placeMeeting(self(g), n(s, t, 0), n(s, t, 1), real(s[t - 2]))?.id ?? -4);
define('sen_place_free', (g, s, t) => g.placeMeeting(self(g), n(s, t, 0), n(s, t, 1), -3, true) === null);
define('sen_place_empty', (g, s, t, argc) => g.placeMeeting(self(g), n(s, t, 0), n(s, t, 1), argc > 2 ? real(s[t - 2]) : -3) === null);

/** Puts an axis-aligned box (exclusive right/bottom) into g.sa as a box shape. */
function box(g: Game, l: number, t: number, r: number, bt: number): number {
  const a = g.sa;
  a[8] = Math.min(l, r); a[9] = Math.min(t, bt); a[10] = Math.max(l, r); a[11] = Math.max(t, bt);
  a[0] = a[8]; a[1] = a[9]; a[2] = a[10]; a[3] = a[9]; a[4] = a[10]; a[5] = a[11]; a[6] = a[8]; a[7] = a[11];
  return 1;
}
const notMe = (g: Game, v: Value, argc: number, k: number): Instance | null => (argc > k && real(v) > 0.5 && g.self instanceof Instance ? g.self : null);

/** A point is a hair-wide box, so the edge pixels of a bbox count (GM bboxes are inclusive). */
const point = (g: Game, x: number, y: number) => box(g, x, y, x + 1e-6, y + 1e-6);

define('sen_position_meeting', (g, s, t) => g.collideShape(point(g, n(s, t, 0), n(s, t, 1)), real(s[t - 2]), null) !== null);
define('sen_position_empty', (g, s, t) => g.collideShape(point(g, n(s, t, 0), n(s, t, 1)), -3, null) === null);
define('sen_instance_position', (g, s, t) => g.collideShape(point(g, n(s, t, 0), n(s, t, 1)), real(s[t - 2]), null)?.id ?? -4);
/**
 * instance_place_list / instance_position_list(x, y, obj, list, ordered): appends every hit's id to the ds_list and
 * returns how many. Ordered sorts by distance from (x, y) to each instance's position (HTML5 AppendCollisionResults).
 */
const hits: Instance[] = [];
define('sen_instance_list', (g, s, t) => {
  const x = n(s, t, 1), y = n(s, t, 2), list = g.data.lists.get(s[t - 4], 'ds_list');
  hits.length = 0;
  if (s[t] === 'place') g.placeMeeting(self(g), x, y, real(s[t - 3]), false, hits);
  else g.collideShape(point(g, x, y), real(s[t - 3]), null, undefined, hits);
  if (real(s[t - 5]) > 0.5) hits.sort((a, c) => (a.x - x) ** 2 + (a.y - y) ** 2 - (c.x - x) ** 2 - (c.y - y) ** 2);
  for (const o of hits) list.a.push(o.id);
  return hits.length;
});
/** device_mouse_x/y_to_gui: the window position mapped through the letterboxed application surface to GUI coordinates. */
define('sen_mouse_gui', (g, s, t) => {
  const [ww, wh] = g.p.renderer.windowSize(), app = g.surface(0), k = Math.min(ww / app.w, wh / app.h);
  return s[t] === 'x' ? ((g.p.input.mouseX - (ww - app.w * k) / 2) / (app.w * k)) * (g.guiW || app.w)
    : ((g.p.input.mouseY - (wh - app.h * k) / 2) / (app.h * k)) * (g.guiH || app.h);
});
define('sen_collision_point', (g, s, t, argc) => g.collideShape(point(g, n(s, t, 0), n(s, t, 1)), real(s[t - 2]), notMe(g, s[t - 4], argc, 4))?.id ?? -4);
define('sen_collision_rect', (g, s, t, argc) => {
  const x1 = n(s, t, 0), y1 = n(s, t, 1), x2 = n(s, t, 2), y2 = n(s, t, 3);
  return g.collideShape(box(g, Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2) + 1, Math.max(y1, y2) + 1), real(s[t - 4]), notMe(g, s[t - 6], argc, 6))?.id ?? -4;
});
define('sen_collision_circle', (g, s, t, argc) => {
  const cx = n(s, t, 0), cy = n(s, t, 1), r = n(s, t, 2);
  box(g, cx - r, cy - r, cx + r, cy + r);
  return g.collideShape(1, real(s[t - 3]), notMe(g, s[t - 5], argc, 5), (o) => {
    const q = g.sb;
    shape(o, o.x, o.y, q);
    const dx = cx - Math.max(q[8], Math.min(cx, q[10])), dy = cy - Math.max(q[9], Math.min(cy, q[11]));
    return dx * dx + dy * dy <= r * r;
  })?.id ?? -4;
});
define('sen_collision_ellipse', (g, s, t, argc) => {
  const x1 = n(s, t, 0), y1 = n(s, t, 1), x2 = n(s, t, 2), y2 = n(s, t, 3);
  return g.collideShape(box(g, Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)), real(s[t - 4]), notMe(g, s[t - 6], argc, 6))?.id ?? -4;
});
define('sen_collision_line', (g, s, t, argc) => {
  const x1 = n(s, t, 0), y1 = n(s, t, 1), x2 = n(s, t, 2), y2 = n(s, t, 3);
  box(g, x1, y1, x2, y2);
  return g.collideShape(1, real(s[t - 4]), notMe(g, s[t - 6], argc, 6), (o) => {
    const q = g.sb;
    shape(o, o.x, o.y, q);
    return segmentHitsBox(x1, y1, x2, y2, q[8], q[9], q[10], q[11]);
  })?.id ?? -4;
});

/** Liang-Barsky clip of a segment against a box. */
function segmentHitsBox(x1: number, y1: number, x2: number, y2: number, l: number, t: number, r: number, bt: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const u = q / p;
    if (p < 0) { if (u > t1) return false; if (u > t0) t0 = u; } else { if (u < t0) return false; if (u < t1) t1 = u; }
    return true;
  };
  return clip(-dx, x1 - l) && clip(dx, r - x1) && clip(-dy, y1 - t) && clip(dy, bt - y1);
}

/** Distance between bounding boxes (0 when they overlap). */
function boxDistance(a: Float64Array, q: Float64Array): number {
  const dx = Math.max(0, q[8] - a[10], a[8] - q[10]), dy = Math.max(0, q[9] - a[11], a[9] - q[11]);
  return Math.hypot(dx, dy);
}
define('sen_distance_to_object', (g, s, t) => {
  const me = self(g), target = real(s[t]);
  if (!shape(me, me.x, me.y, g.sa)) return 1e6;
  let best = 1e6;
  for (const o of g.instances) {
    if (!o.alive || !o.active || o === me || !(target >= 100000 ? o.id === target : target === -3 || o.obj.isA.has(target))) continue;
    if (!shape(o, o.x, o.y, g.sb)) continue;
    best = Math.min(best, boxDistance(g.sa, g.sb));
  }
  return best;
});
define('sen_distance_to_point', (g, s, t) => {
  const me = self(g);
  if (!shape(me, me.x, me.y, g.sa)) return Math.hypot(me.x - n(s, t, 0), me.y - n(s, t, 1));
  const x = n(s, t, 0), y = n(s, t, 1), a = g.sa;
  return Math.hypot(Math.max(0, a[8] - x, x - a[10]), Math.max(0, a[9] - y, y - a[11]));
});

/**
 * collision_rectangle_list(x1, y1, x2, y2, obj, prec, notme, list, ordered) / collision_circle_list(x, y, r, ...):
 * appends every hit's id to the ds_list and returns how many. Ordered sorts by distance from the shape's centre.
 */
define('sen_collision_list', (g, s, t, argc) => {
  const rect = s[t] === 'rectangle', k = rect ? 5 : 4; // index of obj
  const a = n(s, t, 1), c = n(s, t, 2), d = n(s, t, 3);
  const list = g.data.lists.get(s[t - k - 3], 'ds_list'), me = notMe(g, s[t - k - 2], argc, k + 2);
  let cx: number, cy: number;
  hits.length = 0;
  if (rect) {
    const e = n(s, t, 4);
    cx = (a + d) / 2; cy = (c + e) / 2;
    g.collideShape(box(g, Math.min(a, d), Math.min(c, e), Math.max(a, d) + 1, Math.max(c, e) + 1), real(s[t - k]), me, undefined, hits);
  } else {
    cx = a; cy = c;
    box(g, a - d, c - d, a + d, c + d);
    g.collideShape(1, real(s[t - k]), me, (o) => {
      const q = g.sb;
      shape(o, o.x, o.y, q);
      const dx = a - Math.max(q[8], Math.min(a, q[10])), dy = c - Math.max(q[9], Math.min(c, q[11]));
      return dx * dx + dy * dy <= d * d;
    }, hits);
  }
  if (real(s[t - k - 4]) > 0.5) hits.sort((p, q) => (p.x - cx) ** 2 + (p.y - cy) ** 2 - (q.x - cx) ** 2 - (q.y - cy) ** 2);
  for (const o of hits) list.a.push(o.id);
  return hits.length;
});
