// Rooms (rom_*) and layers. Room changes take effect at the end of the step.

import { define, family, n, b, str, type BuiltinFn } from './registry.ts';
import { GmlError, GmStruct, NotImplemented, real, Unverified, type GArray, type Value } from '../value.ts';
import { ELEM, type Element } from '../runtime/layers.ts';
import type { Game } from '../runtime/game.ts';

define('rom_goto', (g, s, t) => { g.goto(n(s, t, 0)); return undefined; });
define('rom_change', (g, s, t) => {
  const order = g.a.roomOrder, at = order.indexOf(g.roomIndex);
  switch (s[t]) {
    case 'restart': g.goto(g.roomIndex); break;
    case 'next': if (at + 1 >= order.length) throw new GmlError('room_goto_next: no next room'); g.goto(order[at + 1]); break;
    case 'previous': if (at <= 0) throw new GmlError('room_goto_previous: no previous room'); g.goto(order[at - 1]); break;
    default: throw new NotImplemented(`rom_change: unknown variant ${String(s[t])}`);
  }
  return undefined;
});
define('rom_info', (g, s, t) => {
  const r = n(s, t, 1), order = g.a.roomOrder, at = order.indexOf(r);
  switch (s[t]) {
    case 'next': return at >= 0 && at + 1 < order.length ? order[at + 1] : -1;
    case 'previous': return at > 0 ? order[at - 1] : -1;
    case 'exists': return !!g.a.rooms[r];
    case 'name': return g.a.rooms[r]?.name ?? '<undefined>';
  }
  throw new NotImplemented(`rom_info: unknown variant ${String(s[t])}`);
});
define('rom_set', (g, s, t) => {
  const r = g.a.rooms[n(s, t, 1)];
  if (!r) throw new Unverified('room_set_*: room does not exist');
  if (s[t] === 'persistent') r.persistent = b(s, t, 2); else if (s[t] === 'width') r.width = n(s, t, 2); else r.height = n(s, t, 2);
  return undefined;
});

// ---------------------------------------------------------------- layers

/**
 * A layer by id or name, or undefined. GM never errors on a missing layer: setters do nothing and getters give a
 * default (HTML5 runner; Ch2 obj_controller_tasquePaintingsRevisit hides a "reference" layer its room lacks; gm_gotchas.md).
 */
const layer = (g: Game, v: Value) => g.layers.find(typeof v === 'string' ? v : real(v));
define('rom_layer_id', (g, s, t) => g.layers.find(str(s, t, 0))?.id ?? -1);
define('rom_layer_exists', (g, s, t) => !!layer(g, s[t]));
define('rom_layer_set_visible', (g, s, t) => { const l = layer(g, s[t]); if (l) l.visible = b(s, t, 1); return undefined; });
define('rom_layer_get_visible', (g, s, t) => layer(g, s[t])?.visible);
define('rom_layer_depth', (g, s, t) => {
  const l = layer(g, s[t]);
  if (!l) return undefined;
  l.depth = n(s, t, 1); g.layers.version++;
  for (const i of g.instances) if (i.layer === l.id) i.depth = l.depth;
  return undefined;
});
define('rom_layer_get_depth', (g, s, t) => layer(g, s[t])?.depth ?? -1);
define('rom_layer_set', (g, s, t) => {
  const l = layer(g, s[t - 1]), v = n(s, t, 2);
  if (!l) return undefined;
  switch (s[t]) { case 'x': l.x = v; break; case 'y': l.y = v; break; case 'hspeed': l.hspeed = v; break; case 'vspeed': l.vspeed = v; break; }
  return undefined;
});
define('rom_layer_get', (g, s, t) => {
  const l = layer(g, s[t - 1]);
  if (!l && ['x', 'y', 'hspeed', 'vspeed'].includes(s[t] as string)) return 0;
  else if (l) switch (s[t]) { case 'x': return l.x; case 'y': return l.y; case 'hspeed': return l.hspeed; case 'vspeed': return l.vspeed; }
  throw new NotImplemented(`layer_get_${String(s[t])} unknown`);
});
define('rom_layer_create', (g, s, t, argc) => g.layers.create(n(s, t, 0), argc > 1 ? str(s, t, 1) : undefined).id);
define('rom_layer_destroy', (g, s, t) => {
  const l = layer(g, s[t]);
  if (!l) return undefined;
  for (const i of g.instances) if (i.alive && i.layer === l.id) g.destroy(i, true);
  g.layers.destroy(l);
  return undefined;
});
define('rom_layer_name', (g, s, t) => g.layers.find(real(s[t]))?.name ?? '');
define('rom_layer_all', (g) => g.layers.list.map((l) => l.id) as GArray);
define('rom_layer_elements', (g, s, t) => {
  const l = layer(g, s[t]);
  if (!l) return [] as GArray;
  const out: GArray = l.elements.map((e) => e.id);
  // Instances are elements of their layer too.
  for (const i of g.instances) if (i.alive && i.layer === l.id) {
    let e = instElements.get(i.id);
    if (!e) { e = g.layers.add(l, ELEM.instance); e.inst = i.id; instElements.set(i.id, e); l.elements.pop(); }
    out.push(e.id);
  }
  return out;
});
const instElements = new Map<number, Element>();
define('rom_element_type', (g, s, t) => {
  const id = real(s[t]);
  for (const e of instElements.values()) if (e.id === id) return ELEM.instance;
  return g.layers.element(id)?.kind ?? -1;
});
define('rom_element_layer', (g, s, t) => {
  const e = g.layers.element(real(s[t]));
  if (e?.kind !== ELEM.instance) return e ? e.layer.id : -1;
  return g.byIdAny(e.inst)?.layer ?? -1;
});
/** layer_element_move(element, layer). An instance element moves its instance (taking the layer's depth). */
define('rom_element_move', (g, s, t) => {
  const e = g.layers.element(real(s[t])), l = layer(g, s[t - 1]);
  if (!e || !l) return undefined;
  if (e.kind === ELEM.instance) {
    const i = g.byIdAny(e.inst);
    if (i) { i.layer = l.id; i.depth = l.depth; }
  } else g.layers.moveElement(e, l);
  e.layer = l;
  return undefined;
});
define('rom_layer_force_depth', () => undefined);
define('rom_layer_instance', (_g, s, t) => {
  const id = real(s[t]);
  for (const e of instElements.values()) if (e.id === id) return e.inst;
  return -4;
});

/*
 * Layer elements. GM never errors on a missing element (or one of another kind): setters and destroy do nothing,
 * getters give the HTML5 runner's per-function default (error_audit.md). Ch2's tile_get_ids_at_depth returns [-1]
 * for no tiles and callers set it (gm_gotchas.md).
 */
const elOf = (g: Game, v: Value, kind: number) => { const e = g.layers.element(real(v)); return e?.kind === kind ? e : undefined; };
const elSet = (kind: number, f: (e: Element, s: Value[], t: number, g: Game) => void): BuiltinFn => (g, s, t) => {
  const e = elOf(g, s[t], kind);
  if (e) f(e, s, t, g);
  return undefined;
};
const elGet = (kind: number, dflt: Value, f: (e: Element) => Value): BuiltinFn => (g, s, t) => { const e = elOf(g, s[t], kind); return e ? f(e) : dflt; };
const elDestroy = (kind: number) => elSet(kind, (e, _s, _t, g) => g.layers.removeElement(e));
/** layer_*_get_id: the first element of a kind on a layer, or -1 (also for a missing layer). */
const firstOf = (g: Game, v: Value, kind: number, name?: string) =>
  layer(g, v)?.elements.find((e) => e.kind === kind && (name === undefined || e.name === name))?.id ?? -1;

const BG = ELEM.background;
family('rom_bg', 'layer_background_', {
  get_id: (g, s, t) => firstOf(g, s[t], BG),
  exists: (g, s, t) => { const l = layer(g, s[t]); return !!l && l.elements.some((e) => e.id === real(s[t - 1])); },
  create: (g, s, t) => { const l = layer(g, s[t]); if (!l) return -1; const e = g.layers.add(l, BG); e.asset = n(s, t, 1); return e.id; },
  destroy: elDestroy(BG),
  visible: elSet(BG, (e, s, t) => { e.visible = b(s, t, 1); }),
  change: elSet(BG, (e, s, t) => { e.asset = n(s, t, 1); }),
  sprite: elSet(BG, (e, s, t) => { e.asset = n(s, t, 1); }),
  htiled: elSet(BG, (e, s, t) => { e.htiled = b(s, t, 1); }),
  vtiled: elSet(BG, (e, s, t) => { e.vtiled = b(s, t, 1); }),
  stretch: elSet(BG, (e, s, t) => { e.stretch = b(s, t, 1); }),
  xscale: elSet(BG, (e, s, t) => { e.xscale = n(s, t, 1); }),
  yscale: elSet(BG, (e, s, t) => { e.yscale = n(s, t, 1); }),
  blend: elSet(BG, (e, s, t) => { e.colour = n(s, t, 1); }),
  alpha: elSet(BG, (e, s, t) => { e.alpha = n(s, t, 1); }),
  index: elSet(BG, (e, s, t) => { e.index = n(s, t, 1); }),
  speed: elSet(BG, (e, s, t) => { e.speed = n(s, t, 1); }),
  get_visible: elGet(BG, true, (e) => e.visible),
  get_sprite: elGet(BG, -1, (e) => e.asset),
  get_htiled: elGet(BG, false, (e) => e.htiled),
  get_vtiled: elGet(BG, false, (e) => e.vtiled),
  get_stretch: elGet(BG, false, (e) => e.stretch),
  get_xscale: elGet(BG, 1, (e) => e.xscale),
  get_yscale: elGet(BG, 1, (e) => e.yscale),
  get_blend: elGet(BG, 0, (e) => e.colour),
  get_alpha: elGet(BG, 0, (e) => e.alpha),
  get_index: elGet(BG, -1, (e) => e.index),
  get_speed: elGet(BG, 0, (e) => e.speed),
});

const TILE = ELEM.tile;
family('rom_tile', 'layer_tile_', {
  exists: (g, s, t, argc) => !!elOf(g, s[t - (argc > 1 ? 1 : 0)], TILE),
  visible: elSet(TILE, (e, s, t) => { e.visible = b(s, t, 1); }),
  x: elSet(TILE, (e, s, t) => { e.x = n(s, t, 1); }),
  y: elSet(TILE, (e, s, t) => { e.y = n(s, t, 1); }),
  alpha: elSet(TILE, (e, s, t) => { e.alpha = n(s, t, 1); }),
  blend: elSet(TILE, (e, s, t) => { e.colour = n(s, t, 1); }),
  xscale: elSet(TILE, (e, s, t) => { e.xscale = n(s, t, 1); }),
  yscale: elSet(TILE, (e, s, t) => { e.yscale = n(s, t, 1); }),
  get_visible: elGet(TILE, false, (e) => e.visible),
  get_x: elGet(TILE, 0, (e) => e.x),
  get_y: elGet(TILE, 0, (e) => e.y),
  get_alpha: elGet(TILE, 0, (e) => e.alpha),
  get_sprite: elGet(TILE, -1, (e) => e.asset),
  destroy: elDestroy(TILE),
});

const SPR = ELEM.sprite;
family('rom_sprite', 'layer_sprite_', {
  exists: (g, s, t) => !!elOf(g, s[t - 1], SPR),
  get_sprite: elGet(SPR, -1, (e) => e.asset),
  change: elSet(SPR, (e, s, t) => { e.asset = n(s, t, 1); }),
  destroy: elDestroy(SPR),
  x: elSet(SPR, (e, s, t) => { e.x = n(s, t, 1); }),
  y: elSet(SPR, (e, s, t) => { e.y = n(s, t, 1); }),
  alpha: elSet(SPR, (e, s, t) => { e.alpha = n(s, t, 1); }),
  index: elSet(SPR, (e, s, t) => { e.index = n(s, t, 1); }),
  speed: elSet(SPR, (e, s, t) => { e.speed = n(s, t, 1); }),
  get_x: elGet(SPR, 0, (e) => e.x),
  get_y: elGet(SPR, 0, (e) => e.y),
  xscale: elSet(SPR, (e, s, t) => { e.xscale = n(s, t, 1); }),
  yscale: elSet(SPR, (e, s, t) => { e.yscale = n(s, t, 1); }),
  get_xscale: elGet(SPR, 1, (e) => e.xscale),
  get_yscale: elGet(SPR, 1, (e) => e.yscale),
  get_index: elGet(SPR, -1, (e) => e.index),
  get_speed: elGet(SPR, 0, (e) => e.speed),
  angle: elSet(SPR, (e, s, t) => { e.angle = n(s, t, 1); }),
  blend: elSet(SPR, (e, s, t) => { e.colour = n(s, t, 1); }),
  get_angle: elGet(SPR, 0, (e) => e.angle),
  get_blend: elGet(SPR, 0, (e) => e.colour),
  get_alpha: elGet(SPR, 0, (e) => e.alpha),
  /** layer_sprite_get_id(layer, name): asset layer sprites keep their room editor names. */
  get_id: (g, s, t) => firstOf(g, s[t], SPR, str(s, t, 1)),
});

const TMAP = ELEM.tilemap;
family('rom_tilemap', 'tilemap_', {
  x: elSet(TMAP, (e, s, t) => { e.x = n(s, t, 1); }),
  y: elSet(TMAP, (e, s, t) => { e.y = n(s, t, 1); }),
  get_x: elGet(TMAP, -1, (e) => e.x),
  get_y: elGet(TMAP, -1, (e) => e.y),
  get_width: elGet(TMAP, -1, (e) => e.w),
  get_height: elGet(TMAP, -1, (e) => e.h),
  get_tileset: elGet(TMAP, -1, (e) => e.asset),
  /** The tile size of the map's tile set (-1 for a missing map). */
  get_tile_width: (g, s, t) => { const e = elOf(g, s[t], TMAP); return (e && g.a.tilesets[e.asset]?.tw) ?? -1; },
  get_tile_height: (g, s, t) => { const e = elOf(g, s[t], TMAP); return (e && g.a.tilesets[e.asset]?.th) ?? -1; },
  tileset: elSet(TMAP, (e, s, t) => { e.asset = n(s, t, 1); }),
  get: (g, s, t) => { const e = elOf(g, s[t], TMAP); return e ? cell(e, Math.floor(n(s, t, 1)), Math.floor(n(s, t, 2))) : -1; },
  /** Pixel position in the room; the tile map sits at its layer's offset plus its own, as it draws. */
  /** tilemap_set(tilemap, tiledata, cell_x, cell_y): false outside the map. */
  set: (g, s, t) => {
    const e = elOf(g, s[t], TMAP), col = Math.floor(n(s, t, 2)), row = Math.floor(n(s, t, 3));
    if (!e?.cells || col < 0 || row < 0 || col >= e.w || row >= e.h) return false;
    e.cells[row * e.w + col] = Math.trunc(n(s, t, 1));
    return true;
  },
  get_at_pixel: (g, s, t) => {
    const e = elOf(g, s[t], TMAP), ts = e && g.a.tilesets[e.asset];
    if (!e || !ts) return -1;
    return cell(e, Math.floor((n(s, t, 1) - e.layer.x - e.x) / ts.tw), Math.floor((n(s, t, 2) - e.layer.y - e.y) / ts.th));
  },
  /** The column / row under a room pixel, or -1 outside the map. */
  get_cell_x_at_pixel: (g, s, t) => cellAt(g, s, t, true),
  get_cell_y_at_pixel: (g, s, t) => cellAt(g, s, t, false),
});
function cellAt(g: Game, s: Value[], t: number, x: boolean): number {
  const e = elOf(g, s[t], TMAP), ts = e && g.a.tilesets[e.asset];
  if (!e || !ts) return -1;
  const c = Math.floor((n(s, t, 1) - e.layer.x - e.x) / ts.tw), r = Math.floor((n(s, t, 2) - e.layer.y - e.y) / ts.th);
  return c >= 0 && r >= 0 && c < e.w && r < e.h ? (x ? c : r) : -1;
}
/** A tile map cell's tile data, or -1 outside the map. */
const cell = (e: Element, col: number, row: number) => (e.cells && col >= 0 && row >= 0 && col < e.w && row < e.h ? e.cells[row * e.w + col] : -1);
/** tile_get_*: fields of a tile data value (krpj.ts TileLayer: index bits 0-18, mirror 28, flip 29, rotate 30). */
define('rom_tile_data', (_g, s, t) => {
  const d = Math.trunc(n(s, t, 1));
  switch (s[t]) { case 'index': return d & 0x7ffff; case 'mirror': return ((d >> 28) & 1) === 1; case 'flip': return ((d >> 29) & 1) === 1; case 'rotate': return ((d >> 30) & 1) === 1; }
  throw new NotImplemented(`tile_get_${String(s[t])} unknown`);
});
/** tile_set_*(tiledata, value): the tile data with that field changed. */
define('rom_tile_set_data', (_g, s, t) => {
  const d = Math.trunc(n(s, t, 1)), bit = (k: number) => (b(s, t, 2) ? d | (1 << k) : d & ~(1 << k));
  switch (s[t]) { case 'index': return (d & ~0x7ffff) | (Math.trunc(n(s, t, 2)) & 0x7ffff); case 'mirror': return bit(28); case 'flip': return bit(29); case 'rotate': return bit(30); }
  throw new NotImplemented(`tile_set_${String(s[t])} unknown`);
});
// ---------------------------------------------------------------- animation curves
// A channel is GM's struct { name, type, iterations, points: [{ posx, value }] }. Imported channels keep their
// curve sampled as a polyline (smooth/bezier: `iterations` samples per segment), which evaluate interpolates.

/** Channel struct -> [x0, y0, x1, y1, ...] samples. Structs the game builds itself evaluate linearly. */
const samples = new WeakMap<GmStruct, Float64Array>();
const channelCache = new WeakMap<Game, Map<number, GmStruct>>();

function sampleChannel(type: number, iterations: number, pts: number[][]): Float64Array {
  if (type === 0 || pts.length < 2) return Float64Array.from(pts.flatMap((p) => [p[0], p[1]]));
  const it = Math.max(1, iterations), out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], d = pts[i + 1];
    for (let k = 0; k < it; k++) {
      const u = k / it, v = 1 - u;
      if (type === 2) { // cubic bezier: a, a + out handle, d + in handle, d
        const b0 = v * v * v, b1 = 3 * v * v * u, b2 = 3 * v * u * u, b3 = u * u * u;
        out.push(b0 * a[0] + b1 * (a[0] + a[4]) + b2 * (d[0] + d[2]) + b3 * d[0], b0 * a[1] + b1 * (a[1] + a[5]) + b2 * (d[1] + d[3]) + b3 * d[1]);
      } else { // Catmull-Rom through the neighbours (ends repeated)
        const p0 = pts[Math.max(0, i - 1)], p3 = pts[Math.min(pts.length - 1, i + 2)];
        const cr = (j: number) => 0.5 * (2 * a[j] + (d[j] - p0[j]) * u + (2 * p0[j] - 5 * a[j] + 4 * d[j] - p3[j]) * u * u + (3 * a[j] - p0[j] - 3 * d[j] + p3[j]) * u * u * u);
        out.push(cr(0), cr(1));
      }
    }
  }
  const last = pts[pts.length - 1];
  out.push(last[0], last[1]);
  return Float64Array.from(out);
}

function channelStruct(g: Game, curve: number, k: number): GmStruct {
  let cache = channelCache.get(g);
  if (!cache) channelCache.set(g, (cache = new Map()));
  const key = curve * 4096 + k, hit = cache.get(key);
  if (hit) return hit;
  const ch = g.a.animcurves[curve].channels[k], st = new GmStruct(), slot = (n: string) => g.a.varSlot(n);
  st.vars.set(slot('name'), ch.name); st.vars.set(slot('type'), ch.type); st.vars.set(slot('iterations'), ch.iterations);
  st.vars.set(slot('points'), ch.points.map((p) => {
    const pt = new GmStruct();
    pt.vars.set(slot('posx'), p[0]); pt.vars.set(slot('value'), p[1]);
    return pt;
  }));
  samples.set(st, sampleChannel(ch.type, ch.iterations, ch.points));
  cache.set(key, st);
  return st;
}

const curveOf = (g: Game, v: Value, fn: string) => {
  const c = g.a.animcurves[real(v)];
  if (!c) throw new Unverified(`${fn}: animation curve ${String(v)} does not exist`);
  return c;
};

family('rom_animcurve', 'animcurve_', {
  get: (g, s, t) => {
    const i = real(s[t]), c = curveOf(g, i, 'animcurve_get'), st = new GmStruct();
    st.vars.set(g.a.varSlot('name'), c.name);
    st.vars.set(g.a.varSlot('channels'), c.channels.map((_, k) => channelStruct(g, i, k)));
    return st;
  },
  /** animcurve_get_channel(curve, name or index) */
  get_channel: (g, s, t) => {
    const i = real(s[t]), c = curveOf(g, i, 'animcurve_get_channel'), w = s[t - 1];
    const k = typeof w === 'string' ? c.channels.findIndex((ch) => ch.name === w) : Math.trunc(real(w));
    if (!c.channels[k]) throw new Unverified(`animcurve_get_channel: ${c.name} has no channel ${String(w)}`);
    return channelStruct(g, i, k);
  },
  get_channel_index: (g, s, t) => curveOf(g, s[t], 'animcurve_get_channel_index').channels.findIndex((ch) => ch.name === str(s, t, 1)),
  exists: (g, s, t) => g.a.animcurves[real(s[t])] !== undefined,
  /** animcurve_channel_evaluate(channel, pos): before the first point / after the last, their values. */
  channel_evaluate: (g, s, t) => {
    const st = s[t], x = n(s, t, 1);
    if (!(st instanceof GmStruct)) throw new Unverified('animcurve_channel_evaluate: not a channel');
    let d = samples.get(st);
    if (!d) {
      const pts = st.vars.get(g.a.varSlot('points'));
      if (!Array.isArray(pts)) throw new Unverified('animcurve_channel_evaluate: channel has no points');
      const px = g.a.varSlot('posx'), pv = g.a.varSlot('value');
      d = Float64Array.from(pts.flatMap((p) => (p instanceof GmStruct ? [real(p.vars.get(px)), real(p.vars.get(pv))] : [])));
    }
    if (d.length < 2) return 0;
    if (x <= d[0]) return d[1];
    for (let j = 2; j < d.length; j += 2) {
      if (x <= d[j]) { const x0 = d[j - 2], span = d[j] - x0; return span > 0 ? d[j - 1] + ((x - x0) / span) * (d[j + 1] - d[j - 1]) : d[j + 1]; }
    }
    return d[d.length - 1];
  },
});
define('rom_layer_tilemap', (g, s, t) => firstOf(g, s[t], TMAP));
define('rom_layer_at_depth', (g, s, t) => {
  const d = n(s, t, 0), out: GArray = g.layers.list.filter((l) => l.depth === d).map((l) => l.id);
  return out.length ? out : [-1];
});
define('rom_layer_shader', (g, s, t) => {
  const l = layer(g, s[t]), sh = real(s[t - 1]);
  if (!l) return undefined;
  if (sh >= 0) {
    const d = g.a.shaders[sh];
    if (!d) throw new Unverified(`layer_shader: shader ${sh} does not exist`);
    if (d.handle < 0) throw new NotImplemented(`layer_shader: shader ${d.name} did not compile`);
  }
  l.shader = sh;
  return undefined;
});
define('rom_camera', (g, s, t) => (real(s[t]) === g.roomIndex ? g.views[n(s, t, 1)]?.camera ?? -1 : -1));
define('rom_layer_script', (g, s, t) => {
  const l = layer(g, s[t - 1]), f = s[t - 2], none = typeof f === 'number' && f < 0;
  if (!l) return undefined;
  if (s[t] === 'begin') l.scriptBegin = none ? null : f; else l.scriptEnd = none ? null : f;
  return undefined;
});
