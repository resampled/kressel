// A room's layers and layer elements at runtime (GMS2 layer model), plus cameras and views.
// Element kinds use GM's layerelementtype_* values.

import type { Layer, View } from '../krpj.ts';
import type { Assets } from './assets.ts';
import { GmlError, type Value } from '../value.ts';

export const ELEM = { background: 1, instance: 2, sprite: 4, tilemap: 5, tile: 7 } as const;

export interface Element {
  id: number; kind: number; layer: RtLayer;
  /** Sprite (backgrounds, sprites, tiles) or tileset (tile maps) index; -1 none. */
  asset: number;
  x: number; y: number; xscale: number; yscale: number; angle: number;
  /** Asset layer sprites: their room editor name (layer_sprite_get_id). */
  name?: string;
  colour: number; alpha: number; visible: boolean;
  index: number; speed: number;
  /** Backgrounds. */
  htiled: boolean; vtiled: boolean; stretch: boolean;
  /** Tiles: source rectangle. Tile maps: cols, rows (in w, h) and cells. */
  sx: number; sy: number; w: number; h: number;
  cells: Int32Array | null;
  /** Instance elements: the instance id. */
  inst: number;
}

export interface RtLayer {
  id: number; name: string; depth: number; visible: boolean;
  x: number; y: number; hspeed: number; vspeed: number;
  elements: Element[];
  /** Created by the room editor as an instance layer. */
  instances: boolean;
  /** layer_script_begin/end: a function value run before/after the layer draws. */
  scriptBegin?: Value | null; scriptEnd?: Value | null;
}

export interface Camera {
  id: number; x: number; y: number; w: number; h: number; angle: number;
  /** Followed object/instance (-1 none), border and max speed (-1 unlimited). */
  target: number; bx: number; by: number; sx: number; sy: number;
}

export interface RtView { visible: boolean; camera: number; px: number; py: number; pw: number; ph: number; surface: number }

let nextElement = 1;
const element = (layer: RtLayer, kind: number): Element => ({
  id: nextElement++, kind, layer, asset: -1, x: 0, y: 0, xscale: 1, yscale: 1, angle: 0, colour: 0xffffff, alpha: 1, visible: true,
  index: 0, speed: 0, htiled: false, vtiled: false, stretch: false, sx: 0, sy: 0, w: 0, h: 0, cells: null, inst: -1,
});

export class Layers {
  list: RtLayer[] = [];
  private nextLayer = 0;
  private readonly byElement = new Map<number, Element>();
  /** Bumped when depths or the layer list change, so draw order is re-sorted. */
  version = 0;

  load(defs: Layer[], a: Assets): void {
    this.list = []; this.byElement.clear(); this.version++;
    this.nextLayer = 0;
    for (const d of defs) {
      const l = this.create(d.depth, d.name, d.id);
      l.visible = d.visible !== false; l.x = d.x ?? 0; l.y = d.y ?? 0; l.hspeed = d.hspeed ?? 0; l.vspeed = d.vspeed ?? 0;
      const spr = (n: string) => { const i = a.assetIndex.get(n); if (i === undefined) throw new GmlError(`unknown sprite ${n}`); return i; };
      switch (d.type) {
        case 'instances': l.instances = true; break;
        case 'background': {
          const e = this.add(l, ELEM.background);
          e.asset = d.sprite === null ? -1 : spr(d.sprite); e.colour = d.color; e.alpha = d.alpha ?? 1;
          e.htiled = d.htiled ?? false; e.vtiled = d.vtiled ?? false; e.stretch = d.stretch ?? false;
          e.index = d.image_index ?? 0; e.speed = d.image_speed ?? 0;
          break;
        }
        case 'assets':
          for (const t of d.tiles ?? []) {
            const e = this.add(l, ELEM.tile);
            [e.x, e.y] = t; e.asset = spr(t[2]); [, , , e.sx, e.sy, e.w, e.h, e.xscale, e.yscale] = t;
            e.colour = t[9] & 0xffffff; e.alpha = (t[9] >>> 24) / 255;
          }
          for (const s of d.sprites ?? []) {
            const e = this.add(l, ELEM.sprite);
            e.asset = spr(s.sprite); e.name = s.name; e.x = s.x; e.y = s.y; e.xscale = s.scale_x ?? 1; e.yscale = s.scale_y ?? 1; e.angle = s.angle ?? 0;
            e.colour = s.colour ?? 0xffffff; e.alpha = s.alpha ?? 1; e.index = s.image_index ?? 0; e.speed = s.image_speed ?? 1;
          }
          break;
        case 'tiles': {
          const e = this.add(l, ELEM.tilemap), ts = d.tileset === null ? -1 : a.assetIndex.get(d.tileset);
          if (ts === undefined) throw new GmlError(`unknown tileset ${d.tileset}`);
          e.asset = ts; e.w = d.cols; e.h = d.rows; e.cells = Int32Array.from(d.data);
          break;
        }
      }
    }
    this.nextLayer = Math.max(this.nextLayer, ...this.list.map((l) => l.id + 1));
  }

  create(depth: number, name?: string, id?: number): RtLayer {
    const l: RtLayer = { id: id ?? this.nextLayer++, name: name ?? `_layer_${(this.nextLayer + 0x1000000).toString(16)}`, depth, visible: true, x: 0, y: 0, hspeed: 0, vspeed: 0, elements: [], instances: false };
    if (id !== undefined) this.nextLayer = Math.max(this.nextLayer, id + 1);
    this.list.push(l); this.version++;
    return l;
  }
  destroy(l: RtLayer): void {
    this.list = this.list.filter((x) => x !== l);
    for (const e of l.elements) this.byElement.delete(e.id);
    this.version++;
  }
  add(l: RtLayer, kind: number): Element {
    const e = element(l, kind);
    l.elements.push(e); this.byElement.set(e.id, e);
    return e;
  }
  removeElement(e: Element): void {
    e.layer.elements = e.layer.elements.filter((x) => x !== e);
    this.byElement.delete(e.id);
  }
  element(id: number): Element | undefined { return this.byElement.get(id); }

  /** A layer by id or name; throws if missing. */
  get(v: number | string): RtLayer {
    const l = this.find(v);
    if (!l) throw new GmlError(`layer ${JSON.stringify(v)} does not exist`);
    return l;
  }
  find(v: number | string): RtLayer | undefined {
    return typeof v === 'string' ? this.list.find((l) => l.name === v) : this.list.find((l) => l.id === v);
  }
  /** The layer at exactly this depth used for instances placed by depth (GM's managed layers). */
  atDepth(depth: number): RtLayer {
    return this.list.find((l) => l.depth === depth && l.instances) ?? Object.assign(this.create(depth), { instances: true });
  }

  /** Scrolling layers move by their speed each step. */
  step(): void {
    for (const l of this.list) { l.x += l.hspeed; l.y += l.vspeed; }
  }
}

export function newCamera(id: number): Camera {
  return { id, x: 0, y: 0, w: 640, h: 480, angle: 0, target: -1, bx: 0, by: 0, sx: -1, sy: -1 };
}

export function viewFrom(v: View | undefined): RtView {
  return v ? { visible: v.visible ?? false, camera: -1, px: v.port[0], py: v.port[1], pw: v.port[2], ph: v.port[3], surface: -1 }
    : { visible: false, camera: -1, px: 0, py: 0, pw: 640, ph: 480, surface: -1 };
}
