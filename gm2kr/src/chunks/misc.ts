// SCPT (script assets), GLOB (global init scripts), BGND (GMS2 tilesets), PATH, ACRV (animation curves), SHDR.

import { FormatError, type Reader } from '../io/reader.ts';

export interface GmScript { name: string; code: number; ctor: boolean }

/** Script assets, in asset-index order (script_execute(n) / asset_get_index use these indices). */
export function readScpt(r: Reader): GmScript[] {
  return r.ptrList(1 << 16).map((p) => {
    const s = r.at(p), name = s.strPtr(), id = s.i32();
    // GMS2.3+ marks constructors with the top bit of the code id.
    return { name, code: id < -1 ? id & 0x7fffffff : id, ctor: id < -1 };
  });
}

/** Code ids run at game start, in order (GMS2.3+ script files' top-level code). */
export function readGlob(r: Reader): number[] {
  const n = r.count(1 << 16), out: number[] = [];
  for (let i = 0; i < n; i++) out.push(r.i32());
  return out;
}

export interface GmTileset {
  name: string; tpag: number;
  tileW: number; tileH: number; borderX: number; borderY: number; columns: number;
  /** Animation frames per tile, and microseconds per frame. */
  frames: number; frameTime: number;
  /** tile index -> frame k -> source tile, as stored (tileCount * frames entries). */
  ids: number[];
}

export function readBgnd(r: Reader): GmTileset[] {
  return r.ptrList(4096).map((p) => {
    const b = r.at(p);
    const name = b.strPtr();
    b.skip(12); // transparent, smooth, preload
    const tpag = b.ptr(true);
    if (b.u32() !== 2) throw new FormatError(`tileset ${name}: unrecognised layout (GMS1 backgrounds not supported yet)`, p);
    const tileW = b.u32(), tileH = b.u32(), borderX = b.u32(), borderY = b.u32(), columns = b.u32();
    const frames = b.u32(), count = b.u32();
    b.skip(4);
    const frameTime = Number(b.u64());
    if (count * frames > 1 << 20) throw new FormatError(`tileset ${name}: too many tiles`, p);
    const ids: number[] = [];
    for (let i = 0; i < count * frames; i++) ids.push(b.u32());
    return { name, tpag, tileW, tileH, borderX, borderY, columns, frames, frameTime, ids };
  });
}

export interface GmPath { name: string; smooth: boolean; closed: boolean; precision: number; points: [number, number, number][] }

/** PATH: name, smooth, closed, precision, then an inline list of (x, y, speed) points. */
export function readPath(r: Reader): GmPath[] {
  return r.ptrList(1 << 14).map((p) => {
    const e = r.at(p);
    const name = e.strPtr(), smooth = e.bool(), closed = e.bool(), precision = e.u32();
    const n = e.count(1 << 16), points: [number, number, number][] = [];
    for (let i = 0; i < n; i++) points.push([e.f32(), e.f32(), e.f32()]);
    return { name, smooth, closed, precision, points };
  });
}

export interface GmAnimCurve { name: string; channels: GmCurveChannel[] }
/** A channel: type 0 linear, 1 smooth (Catmull-Rom), 2 bezier; points are [x, value, bezier x0, y0, x1, y1]. */
export interface GmCurveChannel { name: string; type: number; iterations: number; points: number[][] }

/** ACRV (GMS2.3+): a version word (1), then curves: name, graph type, inline channels of inline points. */
export function readAcrv(r: Reader): GmAnimCurve[] {
  const version = r.u32();
  if (version !== 1) throw new FormatError(`ACRV: unknown version ${version}`, 0);
  return r.ptrList(1 << 14).map((p) => {
    const e = r.at(p), name = e.strPtr();
    e.u32(); // graph type (editor only)
    const channels: GmCurveChannel[] = [];
    for (let n = e.count(1 << 10), i = 0; i < n; i++) {
      const cname = e.strPtr(), type = e.u32(), iterations = e.u32(), points: number[][] = [];
      if (type > 2) throw new FormatError(`animcurve ${name}.${cname}: unknown curve type ${type}`, p);
      for (let k = e.count(1 << 16), j = 0; j < k; j++) points.push([e.f32(), e.f32(), e.f32(), e.f32(), e.f32(), e.f32()]);
      channels.push({ name: cname, type, iterations, points });
    }
    return { name, channels };
  });
}

export interface GmShader { name: string; vertex: string; fragment: string; attributes: string[] }

/**
 * SHDR: name, type (top bit set in GMS2), then GLSL ES, GLSL and HLSL9 vertex/fragment source pointers,
 * two HLSL11 blob pointers and the vertex attribute names. Only GLSL ES is kept (WebGL compiles it).
 */
export function readShdr(r: Reader): GmShader[] {
  const out: GmShader[] = [];
  const count = r.count(1 << 12);
  for (let i = 0; i < count; i++) {
    const p = r.ptr(true);
    if (p === 0) continue; // stripped shaders leave null pointers (gm_gotchas.md)
    const e = r.at(p);
    const name = e.strPtr(), type = e.u32() & 0x7fffffff;
    const vertex = e.strPtr(), fragment = e.strPtr();
    e.skip(24); // GLSL, HLSL9 sources, HLSL11 blobs
    const n = e.count(64), attributes: string[] = [];
    for (let i = 0; i < n; i++) attributes.push(e.strPtr());
    if (!vertex || !fragment) throw new FormatError(`shader ${name} (type ${type}) has no GLSL ES source; HLSL-only shaders aren't supported`, p);
    out.push({ name, vertex, fragment, attributes });
  }
  return out;
}
