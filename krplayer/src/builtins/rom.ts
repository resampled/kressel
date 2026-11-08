// Rooms (rom_*) and layers. Room changes take effect at the end of the step.

import { define, family, n, b, str, type BuiltinFn } from './registry.ts';
import { GmlError, NotImplemented, real, type GArray, type Value } from '../value.ts';
import { ELEM, type Element } from '../runtime/layers.ts';
import type { Game } from '../runtime/game.ts';

define('rom_goto', (g, s, t) => { g.goto(n(s, t, 0)); return undefined; });
define('rom_change', (g, s, t) => {
  const order = g.a.roomOrder, at = order.indexOf(g.roomIndex);
  switch (s[t]) {
    case 'restart': g.goto(g.roomIndex); break;
    case 'next': if (at + 1 >= order.length) throw new GmlError('room_goto_next: no next room'); g.goto(order[at + 1]); break;
    case 'previous': if (at <= 0) throw new GmlError('room_goto_previous: no previous room'); g.goto(order[at - 1]); break;
    default: throw new GmlError(`rom_change: unknown variant ${String(s[t])}`);
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
  throw new GmlError(`rom_info: unknown variant ${String(s[t])}`);
});
define('rom_set', (g, s, t) => {
  const r = g.a.rooms[n(s, t, 1)];
  if (!r) throw new GmlError('room_set_*: room does not exist');
  if (s[t] === 'persistent') r.persistent = b(s, t, 2); else if (s[t] === 'width') r.width = n(s, t, 2); else r.height = n(s, t, 2);
  return undefined;
});

// ---------------------------------------------------------------- layers

const layer = (g: Game, v: Value) => g.layers.get(typeof v === 'string' ? v : real(v));
define('rom_layer_id', (g, s, t) => g.layers.find(str(s, t, 0))?.id ?? -1);
define('rom_layer_exists', (g, s, t) => !!g.layers.find(typeof s[t] === 'string' ? s[t] as string : real(s[t])));
define('rom_layer_set_visible', (g, s, t) => { layer(g, s[t]).visible = b(s, t, 1); return undefined; });
define('rom_layer_get_visible', (g, s, t) => layer(g, s[t]).visible);
define('rom_layer_depth', (g, s, t) => {
  const l = layer(g, s[t]);
  l.depth = n(s, t, 1); g.layers.version++;
  for (const i of g.instances) if (i.layer === l.id) i.depth = l.depth;
  return undefined;
});
define('rom_layer_get_depth', (g, s, t) => layer(g, s[t]).depth);
define('rom_layer_set', (g, s, t) => {
  const l = layer(g, s[t - 1]), v = n(s, t, 2);
  switch (s[t]) { case 'x': l.x = v; break; case 'y': l.y = v; break; case 'hspeed': l.hspeed = v; break; case 'vspeed': l.vspeed = v; break; }
  return undefined;
});
define('rom_layer_get', (g, s, t) => {
  const l = layer(g, s[t - 1]);
  switch (s[t]) { case 'x': return l.x; case 'y': return l.y; case 'hspeed': return l.hspeed; case 'vspeed': return l.vspeed; }
  throw new GmlError(`layer_get_${String(s[t])} unknown`);
});
define('rom_layer_create', (g, s, t, argc) => g.layers.create(n(s, t, 0), argc > 1 ? str(s, t, 1) : undefined).id);
define('rom_layer_destroy', (g, s, t) => {
  const l = layer(g, s[t]);
  for (const i of g.instances) if (i.alive && i.layer === l.id) g.destroy(i, true);
  g.layers.destroy(l);
  return undefined;
});
define('rom_layer_name', (g, s, t) => g.layers.find(real(s[t]))?.name ?? '');
define('rom_layer_all', (g) => g.layers.list.map((l) => l.id) as GArray);
define('rom_layer_elements', (g, s, t) => {
  const l = layer(g, s[t]), out: GArray = l.elements.map((e) => e.id);
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
define('rom_layer_force_depth', () => undefined);
define('rom_layer_instance', (_g, s, t) => {
  const id = real(s[t]);
  for (const e of instElements.values()) if (e.id === id) return e.inst;
  return -4;
});

/** A layer element of a given kind by id. */
function el(g: Game, v: Value, kind: number, what: string): Element {
  const e = g.layers.element(real(v));
  if (!e || e.kind !== kind) throw new GmlError(`${what}: element ${String(v)} does not exist`);
  return e;
}
const bg = (g: Game, v: Value) => el(g, v, ELEM.background, 'layer_background');

family('rom_bg', 'layer_background_', {
  get_id: (g, s, t) => layer(g, s[t]).elements.find((e) => e.kind === ELEM.background)?.id ?? -1,
  exists: (g, s, t) => { const l = g.layers.find(typeof s[t] === 'string' ? s[t] as string : real(s[t])); return !!l && l.elements.some((e) => e.id === real(s[t - 1])); },
  create: (g, s, t) => { const e = g.layers.add(layer(g, s[t]), ELEM.background); e.asset = n(s, t, 1); return e.id; },
  destroy: (g, s, t) => { g.layers.removeElement(bg(g, s[t])); return undefined; },
  visible: (g, s, t) => { bg(g, s[t]).visible = b(s, t, 1); return undefined; },
  change: (g, s, t) => { bg(g, s[t]).asset = n(s, t, 1); return undefined; },
  sprite: (g, s, t) => { bg(g, s[t]).asset = n(s, t, 1); return undefined; },
  htiled: (g, s, t) => { bg(g, s[t]).htiled = b(s, t, 1); return undefined; },
  vtiled: (g, s, t) => { bg(g, s[t]).vtiled = b(s, t, 1); return undefined; },
  stretch: (g, s, t) => { bg(g, s[t]).stretch = b(s, t, 1); return undefined; },
  xscale: (g, s, t) => { bg(g, s[t]).xscale = n(s, t, 1); return undefined; },
  yscale: (g, s, t) => { bg(g, s[t]).yscale = n(s, t, 1); return undefined; },
  blend: (g, s, t) => { bg(g, s[t]).colour = n(s, t, 1); return undefined; },
  alpha: (g, s, t) => { bg(g, s[t]).alpha = n(s, t, 1); return undefined; },
  index: (g, s, t) => { bg(g, s[t]).index = n(s, t, 1); return undefined; },
  speed: (g, s, t) => { bg(g, s[t]).speed = n(s, t, 1); return undefined; },
  get_visible: (g, s, t) => bg(g, s[t]).visible,
  get_sprite: (g, s, t) => bg(g, s[t]).asset,
  get_htiled: (g, s, t) => bg(g, s[t]).htiled,
  get_vtiled: (g, s, t) => bg(g, s[t]).vtiled,
  get_stretch: (g, s, t) => bg(g, s[t]).stretch,
  get_xscale: (g, s, t) => bg(g, s[t]).xscale,
  get_yscale: (g, s, t) => bg(g, s[t]).yscale,
  get_blend: (g, s, t) => bg(g, s[t]).colour,
  get_alpha: (g, s, t) => bg(g, s[t]).alpha,
  get_index: (g, s, t) => bg(g, s[t]).index,
  get_speed: (g, s, t) => bg(g, s[t]).speed,
});

const tile = (g: Game, v: Value) => el(g, v, ELEM.tile, 'layer_tile');
/** Setters on a missing tile do nothing, as GM: Ch2's tile_get_ids_at_depth returns [-1] for no tiles and callers set it (gm_gotchas.md). */
const setTile = (f: (e: Element, s: Value[], t: number) => void): BuiltinFn => (g, s, t) => {
  const e = g.layers.element(real(s[t]));
  if (e?.kind === ELEM.tile) f(e, s, t);
  return undefined;
};
family('rom_tile', 'layer_tile_', {
  exists: (g, s, t, argc) => { const e = g.layers.element(real(s[t - (argc > 1 ? 1 : 0)])); return !!e && e.kind === ELEM.tile; },
  visible: setTile((e, s, t) => { e.visible = b(s, t, 1); }),
  x: setTile((e, s, t) => { e.x = n(s, t, 1); }),
  y: setTile((e, s, t) => { e.y = n(s, t, 1); }),
  alpha: setTile((e, s, t) => { e.alpha = n(s, t, 1); }),
  blend: setTile((e, s, t) => { e.colour = n(s, t, 1); }),
  xscale: setTile((e, s, t) => { e.xscale = n(s, t, 1); }),
  yscale: setTile((e, s, t) => { e.yscale = n(s, t, 1); }),
  get_visible: (g, s, t) => tile(g, s[t]).visible,
  get_x: (g, s, t) => tile(g, s[t]).x,
  get_y: (g, s, t) => tile(g, s[t]).y,
  get_alpha: (g, s, t) => tile(g, s[t]).alpha,
  get_sprite: (g, s, t) => tile(g, s[t]).asset,
  destroy: (g, s, t) => { g.layers.removeElement(tile(g, s[t])); return undefined; },
});

const lsprite = (g: Game, v: Value) => el(g, v, ELEM.sprite, 'layer_sprite');
family('rom_sprite', 'layer_sprite_', {
  exists: (g, s, t) => g.layers.element(real(s[t - 1]))?.kind === ELEM.sprite,
  get_sprite: (g, s, t) => lsprite(g, s[t]).asset,
  change: (g, s, t) => { lsprite(g, s[t]).asset = n(s, t, 1); return undefined; },
  destroy: (g, s, t) => { g.layers.removeElement(lsprite(g, s[t])); return undefined; },
  x: (g, s, t) => { lsprite(g, s[t]).x = n(s, t, 1); return undefined; },
  y: (g, s, t) => { lsprite(g, s[t]).y = n(s, t, 1); return undefined; },
  alpha: (g, s, t) => { lsprite(g, s[t]).alpha = n(s, t, 1); return undefined; },
  index: (g, s, t) => { lsprite(g, s[t]).index = n(s, t, 1); return undefined; },
  speed: (g, s, t) => { lsprite(g, s[t]).speed = n(s, t, 1); return undefined; },
  get_x: (g, s, t) => lsprite(g, s[t]).x,
  get_y: (g, s, t) => lsprite(g, s[t]).y,
  xscale: (g, s, t) => { lsprite(g, s[t]).xscale = n(s, t, 1); return undefined; },
  yscale: (g, s, t) => { lsprite(g, s[t]).yscale = n(s, t, 1); return undefined; },
  get_xscale: (g, s, t) => lsprite(g, s[t]).xscale,
  get_yscale: (g, s, t) => lsprite(g, s[t]).yscale,
  get_index: (g, s, t) => lsprite(g, s[t]).index,
  get_speed: (g, s, t) => lsprite(g, s[t]).speed,
  /** layer_sprite_get_id(layer, name): asset layer sprites keep their room editor names. */
  get_id: (g, s, t) => layer(g, s[t]).elements.find((e) => e.kind === ELEM.sprite && e.name === str(s, t, 1))?.id ?? -1,
});

const tmap = (g: Game, v: Value) => el(g, v, ELEM.tilemap, 'tilemap');
family('rom_tilemap', 'tilemap_', {
  x: (g, s, t) => { tmap(g, s[t]).x = n(s, t, 1); return undefined; },
  y: (g, s, t) => { tmap(g, s[t]).y = n(s, t, 1); return undefined; },
  get_x: (g, s, t) => tmap(g, s[t]).x,
  get_y: (g, s, t) => tmap(g, s[t]).y,
  get_width: (g, s, t) => tmap(g, s[t]).w,
  get_height: (g, s, t) => tmap(g, s[t]).h,
  get_tileset: (g, s, t) => tmap(g, s[t]).asset,
  tileset: (g, s, t) => { tmap(g, s[t]).asset = n(s, t, 1); return undefined; },
});
define('rom_layer_tilemap', (g, s, t) => layer(g, s[t]).elements.find((e) => e.kind === ELEM.tilemap)?.id ?? -1);
define('rom_layer_at_depth', (g, s, t) => {
  const d = n(s, t, 0), out: GArray = g.layers.list.filter((l) => l.depth === d).map((l) => l.id);
  return out.length ? out : [-1];
});
define('rom_layer_script', (g, s, t) => {
  const l = layer(g, s[t - 1]), f = s[t - 2], none = typeof f === 'number' && f < 0;
  if (l.instances && !none) throw new NotImplemented('layer_script_begin/end on instance layers is not implemented in krplayer yet');
  if (s[t] === 'begin') l.scriptBegin = none ? null : f; else l.scriptEnd = none ? null : f;
  return undefined;
});
