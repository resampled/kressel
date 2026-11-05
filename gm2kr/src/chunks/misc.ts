// SCPT (script assets), GLOB (global init scripts) and BGND (GMS2 tilesets).

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
