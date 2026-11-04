// ROOM: rooms, their views, instances and (GMS2) layers.

import { FormatError, type Reader } from '../io/reader.ts';
import type { GmFormat } from '../format.ts';

export interface GmView { enabled: boolean; view: [number, number, number, number]; port: [number, number, number, number] }
export interface GmRoomInstance {
  x: number; y: number; object: number; id: number; creationCode: number;
  scaleX: number; scaleY: number; imageSpeed: number; imageIndex: number; color: number; rotation: number;
}
export type GmLayer = {
  name: string; id: number; depth: number; visible: boolean; x: number; y: number; hspeed: number; vspeed: number;
} & (
  | { type: 'instances'; instances: number[] }
  | { type: 'background'; sprite: number; color: number; htiled: boolean; vtiled: boolean; stretch: boolean; bgVisible: boolean }
);
export interface GmRoom {
  name: string; width: number; height: number; speed: number; persistent: boolean;
  bgColor: number; drawBgColor: boolean; creationCode: number;
  views: GmView[]; instances: GmRoomInstance[]; layers: GmLayer[];
}

const LAYER_KIND: Record<number, string> = { 1: 'background', 2: 'instances', 3: 'assets', 4: 'tiles', 6: 'effect' };

function readLayer(r: Reader, p: number, fmt: GmFormat, room: string): GmLayer {
  const l = r.at(p);
  const name = l.strPtr(), id = l.u32(), type = l.u32(), depth = l.i32();
  const x = l.f32(), y = l.f32(), hspeed = l.f32(), vspeed = l.f32(), visible = l.bool();
  if (fmt.layerEffects) {
    l.skip(8); // effect enabled, effect type
    l.skip(12 * l.count(1024)); // effect properties
  }
  const base = { name, id, depth, visible, x, y, hspeed, vspeed };
  if (type === 2) {
    const n = l.count(1 << 16), instances: number[] = [];
    for (let i = 0; i < n; i++) instances.push(l.u32());
    return { ...base, type: 'instances', instances };
  }
  if (type === 1) {
    const bgVisible = l.bool(); l.skip(4); // foreground
    const sprite = l.i32(), htiled = l.bool(), vtiled = l.bool(), stretch = l.bool(), color = l.u32();
    return { ...base, type: 'background', sprite, color, htiled, vtiled, stretch, bgVisible };
  }
  throw new FormatError(`room ${room}: layer "${name}" has unsupported type ${LAYER_KIND[type] ?? type}`, p);
}

export function readRoom(r: Reader, fmt: GmFormat): GmRoom[] {
  return r.ptrList(1 << 14).map((p) => {
    const o = r.at(p);
    const name = o.strPtr(); o.skip(4); // caption
    const width = o.u32(), height = o.u32(), speed = o.u32(), persistent = o.bool();
    const bgColor = o.u32(), drawBgColor = o.bool(), creationCode = o.i32();
    o.skip(4); // flags
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
      return { enabled: v.bool(), view: [v.i32(), v.i32(), v.i32(), v.i32()], port: [v.i32(), v.i32(), v.i32(), v.i32()] };
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
    return { name, width, height, speed, persistent, bgColor, drawBgColor, creationCode, views, instances, layers };
  });
}
