// ROOM: rooms, their views, instances and (GMS2) layers.

import { FormatError, type Reader } from '../io/reader.ts';
import type { GmFormat } from '../format.ts';

export interface GmView {
  enabled: boolean; view: [number, number, number, number]; port: [number, number, number, number];
  border: [number, number]; speed: [number, number]; follow: number;
}
export interface GmRoomInstance {
  x: number; y: number; object: number; id: number; creationCode: number;
  scaleX: number; scaleY: number; imageSpeed: number; imageIndex: number; color: number; rotation: number;
}
/** A GMS1-style tile kept in a GMS2 asset layer; `sprite` is a sprite index. */
export interface GmLegacyTile {
  x: number; y: number; sprite: number; sx: number; sy: number; w: number; h: number; depth: number; id: number;
  scaleX: number; scaleY: number; color: number;
}
export interface GmLayerSprite {
  name: string; sprite: number; x: number; y: number; scaleX: number; scaleY: number; color: number;
  animSpeed: number; animSpeedType: number; frame: number; rotation: number;
}
export type GmLayer = {
  name: string; id: number; depth: number; visible: boolean; x: number; y: number; hspeed: number; vspeed: number;
} & (
  | { type: 'instances'; instances: number[] }
  | { type: 'background'; sprite: number; color: number; htiled: boolean; vtiled: boolean; stretch: boolean; bgVisible: boolean;
      foreground: boolean; frame: number; animSpeed: number; animSpeedType: number }
  | { type: 'assets'; tiles: GmLegacyTile[]; sprites: GmLayerSprite[] }
  | { type: 'tiles'; tileset: number; cols: number; rows: number; data: Uint32Array }
  | { type: 'effect' }
  | { type: 'path' }
);
export interface GmRoom {
  name: string; caption: string; width: number; height: number; speed: number; persistent: boolean;
  bgColor: number; drawBgColor: boolean; creationCode: number; flags: number;
  views: GmView[]; instances: GmRoomInstance[]; layers: GmLayer[];
}

const LAYER_KIND: Record<number, string> = { 0: 'path', 1: 'background', 2: 'instances', 3: 'assets', 4: 'tiles', 6: 'effect' };

/** A list whose pointers are read in place: count, then pointers to fixed-layout entries. */
function list<T>(r: Reader, p: number, max: number, read: (e: Reader) => T): T[] {
  return r.at(p).ptrList(max).map((e) => read(r.at(e)));
}

function readLayer(r: Reader, p: number, fmt: GmFormat, room: string): GmLayer {
  const l = r.at(p);
  const name = l.strPtr(), id = l.u32(), type = l.u32(), depth = l.i32();
  const x = l.f32(), y = l.f32(), hspeed = l.f32(), vspeed = l.f32(), visible = l.bool();
  if (fmt.layerEffects) {
    l.skip(8); // effect enabled, effect type
    l.skip(12 * l.count(1024)); // effect properties
  }
  const base = { name, id, depth, visible, x, y, hspeed, vspeed };
  switch (type) {
    case 2: {
      const n = l.count(1 << 16), instances: number[] = [];
      for (let i = 0; i < n; i++) instances.push(l.u32());
      return { ...base, type: 'instances', instances };
    }
    case 1: {
      const bgVisible = l.bool(), foreground = l.bool();
      const sprite = l.i32(), htiled = l.bool(), vtiled = l.bool(), stretch = l.bool(), color = l.u32();
      const frame = l.f32(), animSpeed = l.f32(), animSpeedType = l.u32();
      return { ...base, type: 'background', sprite, color, htiled, vtiled, stretch, bgVisible, foreground, frame, animSpeed, animSpeedType };
    }
    case 3: {
      // Pointers (legacy tiles, sprites, sequences, then newer kinds) up to where the first list starts.
      const first = l.ptr(), at = l.pos - 4, n = (first - at) / 4;
      if (!Number.isInteger(n) || n < 2 || n > 8) throw new FormatError(`room ${room}: layer "${name}": unrecognised asset layer layout`, p);
      const ptrs = [first];
      for (let i = 1; i < n; i++) ptrs.push(l.ptr());
      const tiles = list(r, ptrs[0], 1 << 16, (t): GmLegacyTile => ({
        x: t.i32(), y: t.i32(), sprite: t.i32(), sx: t.i32(), sy: t.i32(), w: t.i32(), h: t.i32(), depth: t.i32(), id: t.u32(),
        scaleX: t.f32(), scaleY: t.f32(), color: t.u32(),
      }));
      const sprites = list(r, ptrs[1], 1 << 16, (s): GmLayerSprite => ({
        name: s.strPtr(), sprite: s.i32(), x: s.i32(), y: s.i32(), scaleX: s.f32(), scaleY: s.f32(), color: s.u32(),
        animSpeed: s.f32(), animSpeedType: s.u32(), frame: s.f32(), rotation: s.f32(),
      }));
      for (let i = 2; i < n; i++) if (r.at(ptrs[i]).u32() !== 0) throw new FormatError(`room ${room}: layer "${name}": sequences/particles in asset layers not supported yet`, ptrs[i]);
      return { ...base, type: 'assets', tiles, sprites };
    }
    case 4: {
      const tileset = l.i32(), cols = l.u32(), rows = l.u32();
      if (cols * rows > 1 << 22) throw new FormatError(`room ${room}: layer "${name}": tile layer too large`, p);
      const data = new Uint32Array(cols * rows);
      for (let i = 0; i < data.length; i++) data[i] = l.u32();
      return { ...base, type: 'tiles', tileset, cols, rows, data };
    }
    case 6: return { ...base, type: 'effect' };
    case 0: return { ...base, type: 'path' }; // editor-only: a path layer holds no runtime data
  }
  throw new FormatError(`room ${room}: layer "${name}" has unsupported type ${LAYER_KIND[type] ?? type}`, p);
}

export function readRoom(r: Reader, fmt: GmFormat): GmRoom[] {
  return r.ptrList(1 << 14).map((p) => {
    const o = r.at(p);
    const name = o.strPtr(), caption = o.strPtr();
    const width = o.u32(), height = o.u32(), speed = o.u32(), persistent = o.bool();
    const bgColor = o.u32(), drawBgColor = o.bool(), creationCode = o.i32();
    const flags = o.u32();
    const bgPtr = o.ptr(), viewsPtr = o.ptr(), objsPtr = o.ptr();
    o.skip(4); // tiles
    // GM 2024.13 added an instance creation order pointer; the backgrounds list follows the header.
    const headerSize = 88 + (fmt.gms2 ? 4 : 0) + (fmt.gms23 ? 4 : 0);
    if (bgPtr === p + headerSize + 4) o.skip(4);
    else if (bgPtr !== p + headerSize) throw new FormatError(`room ${name}: unrecognised header layout`, p);
    o.skip(32); // physics world, bounds, gravity, meters per pixel
    const layersPtr = fmt.gms2 ? o.ptr() : 0;

    const views = o.at(viewsPtr).ptrList(8).map((vp): GmView => {
      const v = o.at(vp);
      return {
        enabled: v.bool(), view: [v.i32(), v.i32(), v.i32(), v.i32()], port: [v.i32(), v.i32(), v.i32(), v.i32()],
        border: [v.u32(), v.u32()], speed: [v.i32(), v.i32()], follow: v.i32(),
      };
    });

    const objPtrs = o.at(objsPtr).ptrList(1 << 16);
    // GMS2.2.2.302 added image speed/index; tell the layouts apart by entry size.
    const withImage = objPtrs.length < 2 || objPtrs[1] - objPtrs[0] >= 44;
    const instances = objPtrs.map((ip): GmRoomInstance => {
      const i = o.at(ip);
      const x = i.i32(), y = i.i32(), object = i.i32(), id = i.u32(), cc = i.i32(), scaleX = i.f32(), scaleY = i.f32();
      const imageSpeed = withImage ? i.f32() : 1, imageIndex = withImage ? i.i32() : 0;
      return { x, y, object, id, creationCode: cc, scaleX, scaleY, imageSpeed, imageIndex, color: i.u32(), rotation: i.f32() };
    });
    const layers = layersPtr ? o.at(layersPtr).ptrList(1024).map((lp) => readLayer(o, lp, fmt, name)) : [];
    return { name, caption, width, height, speed, persistent, bgColor, drawBgColor, creationCode, flags, views, instances, layers };
  });
}
