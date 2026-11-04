// FONT: bitmap fonts. Version-dependent fields (ascender, SDF spread, line height...) sit between
// the scale and the glyph list, so the glyph list is found by probing for a self-consistent pointer list.

import { FormatError, type Reader } from '../io/reader.ts';

export interface GmGlyph { char: number; x: number; y: number; w: number; h: number; shift: number; offset: number; kerning: [number, number][] }
export interface GmFont {
  name: string; displayName: string; size: number; bold: boolean; italic: boolean;
  antialias: number; tpag: number; glyphs: GmGlyph[];
}

function findPtrList(f: Reader, base: number): number[] | null {
  for (let k = 0; k <= 6; k++) {
    const at = base + 4 * k;
    try {
      const list = f.at(at).ptrList(0x10000);
      if (list.length > 0 && list[0] === at + 4 + 4 * list.length) return list;
    } catch { /* try the next layout */ }
  }
  return null;
}

export function readFont(r: Reader): GmFont[] {
  return r.ptrList(4096).map((p) => {
    const f = r.at(p);
    const name = f.strPtr(), displayName = f.strPtr();
    const raw = f.u32();
    // GMS2.3+ stores the size as a negated float.
    const size = raw & 0x80000000 ? -new Float32Array(new Uint32Array([raw]).buffer)[0] : raw;
    const bold = f.bool(), italic = f.bool();
    f.skip(3); // range start (u16), charset
    const antialias = f.u8();
    f.skip(4); // range end
    const tpag = f.ptr();
    f.skip(8); // scale x/y
    const glyphPtrs = findPtrList(f, f.pos);
    if (!glyphPtrs) throw new FormatError(`font ${name}: glyph list not found`, f.pos);
    const glyphs = glyphPtrs.map((gp) => {
      const g = f.at(gp);
      const glyph: GmGlyph = { char: g.u16(), x: g.u16(), y: g.u16(), w: g.u16(), h: g.u16(), shift: g.i16(), offset: g.i16(), kerning: [] };
      const nk = g.u16();
      if (nk > 4096) throw new FormatError(`font ${name}: too many kerning pairs`, gp);
      for (let i = 0; i < nk; i++) glyph.kerning.push([g.i16(), g.i16()]);
      return glyph;
    });
    return { name, displayName, size, bold, italic, antialias, tpag, glyphs };
  });
}
