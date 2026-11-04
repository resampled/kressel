// TPAG: texture page items, i.e. rectangles on a texture page (TXTR entry).

import { FormatError, type Reader } from '../io/reader.ts';

export interface TpagItem {
  /** Rectangle on the texture page. */
  sx: number; sy: number; sw: number; sh: number;
  /** Where that rectangle goes in the (untrimmed) image, and the image size. */
  tx: number; ty: number; tw: number; th: number; bw: number; bh: number;
  page: number;
}

export function readTpagItem(r: Reader): TpagItem {
  const v: number[] = [];
  for (let i = 0; i < 11; i++) v.push(r.u16());
  return { sx: v[0], sy: v[1], sw: v[2], sh: v[3], tx: v[4], ty: v[5], tw: v[6], th: v[7], bw: v[8], bh: v[9], page: v[10] };
}

/** All TPAG items keyed by their absolute address (sprites and fonts refer to them by pointer). */
export function readTpag(r: Reader): Map<number, TpagItem> {
  const out = new Map<number, TpagItem>();
  for (const p of r.ptrList(1 << 18)) out.set(p, readTpagItem(r.at(p)));
  return out;
}

export function tpagAt(items: Map<number, TpagItem>, p: number, where: string): TpagItem {
  const t = items.get(p);
  if (!t) throw new FormatError(`${where}: pointer is not a TPAG item`, p);
  return t;
}
