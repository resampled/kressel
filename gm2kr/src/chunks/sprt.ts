// SPRT: sprites, with their collision masks.

import { FormatError, type Reader } from '../io/reader.ts';

export interface GmSprite {
  name: string;
  width: number; height: number;
  /** Bounding box margins (inclusive) relative to the image, as stored. */
  margins: { left: number; right: number; bottom: number; top: number };
  /** 0 axis-aligned rect, 1 precise, 2 rotated rect. */
  maskKind: number;
  origin: [number, number];
  /** Playback speed and type (0 = frames per second, 1 = frames per game frame). */
  speed: number; speedType: number;
  /** TPAG item pointers, one per frame. */
  frames: number[];
  /** Collision masks (one, or one per frame): rows of ceil(width / 8) bytes, MSB = leftmost pixel. */
  masks: Uint8Array[];
}

export function readSprt(r: Reader): GmSprite[] {
  return r.ptrList(1 << 16).map((p) => {
    const s = r.at(p);
    const name = s.strPtr(), width = s.u32(), height = s.u32();
    const margins = { left: s.i32(), right: s.i32(), bottom: s.i32(), top: s.i32() };
    s.skip(16); // transparent, smooth, preload, bbox mode
    const maskKind = s.u32();
    const origin: [number, number] = [s.i32(), s.i32()];
    let speed = 15, speedType = 0;
    if (s.i32() === -1) {
      const ver = s.u32(), type = s.u32();
      speed = s.f32(); speedType = s.u32();
      if (ver >= 2) s.skip(4); // sequence
      if (ver >= 3) s.skip(4); // nine-slice
      if (type !== 0) throw new FormatError(`sprite ${name}: unsupported sprite type ${type} (SWF/Spine)`, p);
    } else {
      s.pos -= 4; // GMS1 layout: the frame list starts here
    }
    const frames = s.ptrList(1 << 14);
    if (width > 1 << 14 || height > 1 << 14) throw new FormatError(`sprite ${name}: size ${width}x${height} too large`, p);
    const n = s.count(1 << 14), size = ((width + 7) >> 3) * height, masks: Uint8Array[] = [];
    for (let i = 0; i < n; i++) masks.push(s.bytes(size).slice());
    return { name, width, height, margins, maskKind, origin, speed, speedType, frames, masks };
  });
}
