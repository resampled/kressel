// GmModel: everything gm2kr reads from a data.win, as GameMaker-side types (not krpj).

import { chunkReader, readChunks } from './datawin.ts';
import { detectFormat, type GmFormat } from './format.ts';
import { FormatError, type Reader } from './io/reader.ts';
import { readGen8, type Gen8 } from './chunks/gen8.ts';
import { readStrg } from './chunks/strg.ts';
import { readTpag, type TpagItem } from './chunks/tpag.ts';
import { readTxtr, type TexturePage } from './chunks/txtr.ts';
import { readSprt, type GmSprite } from './chunks/sprt.ts';
import { readFont, type GmFont } from './chunks/font.ts';
import { readObjt, type GmObject } from './chunks/objt.ts';
import { readRoom, type GmRoom } from './chunks/room.ts';
import { readCode, readRefs, type GmCode, type GmRefs } from './chunks/code.ts';
import { readAgrp, readAudo, readSond, type GmSound } from './chunks/audio.ts';
import { readAcrv, readBgnd, readGlob, readPath, readScpt, readShdr, type GmAnimCurve, type GmPath, type GmScript, type GmShader, type GmTileset } from './chunks/misc.ts';

export interface GmModel {
  buf: ArrayBuffer;
  fmt: GmFormat;
  gen8: Gen8;
  strings: string[];
  tpag: Map<number, TpagItem>;
  textures: TexturePage[];
  sprites: GmSprite[];
  fonts: GmFont[];
  objects: GmObject[];
  rooms: GmRoom[];
  code: GmCode[];
  refs: GmRefs;
  scripts: GmScript[];
  /** Code ids of the global init scripts, in run order. */
  globalInit: number[];
  sounds: GmSound[];
  audioGroups: string[];
  /** Audio group 0's embedded audio (data.win AUDO). */
  audio: Uint8Array[];
  tilesets: GmTileset[];
  paths: GmPath[];
  animcurves: GmAnimCurve[];
  shaders: GmShader[];
}

/** Chunks gm2kr doesn't convert yet. Present-and-non-empty means the game uses a missing feature. */
const UNSUPPORTED = ['TMLN'];

export function readModel(buf: ArrayBuffer): GmModel {
  const chunks = readChunks(buf);
  const need = (name: string): Reader => {
    const r = chunkReader(buf, chunks, name);
    if (!r) throw new FormatError(`missing ${name} chunk`, 0);
    return r;
  };
  const opt = <T>(name: string, read: (r: Reader) => T[]): T[] => {
    const r = chunkReader(buf, chunks, name);
    return r ? read(r) : [];
  };
  const gen8 = readGen8(need('GEN8'));
  const fmt = detectFormat(gen8, chunks);
  for (const name of UNSUPPORTED) {
    const r = chunkReader(buf, chunks, name);
    if (!r || r.end - r.start < 4) continue;
    // Empty list chunks are a u32 0, or a list of null pointers (e.g. SHDR with stripped shaders).
    const n = r.count(1 << 16);
    for (let i = 0; i < n; i++) if (r.u32() !== 0) throw new FormatError(`${name} chunk is not supported yet`, r.start);
  }
  return {
    buf, fmt, gen8,
    strings: readStrg(need('STRG')),
    tpag: readTpag(need('TPAG')),
    textures: opt('TXTR', readTxtr),
    sprites: opt('SPRT', readSprt),
    fonts: opt('FONT', readFont),
    objects: opt('OBJT', readObjt),
    rooms: opt('ROOM', (r) => readRoom(r, fmt)),
    code: opt('CODE', readCode),
    refs: readRefs(need('VARI'), need('FUNC'), fmt),
    scripts: opt('SCPT', readScpt),
    globalInit: chunkReader(buf, chunks, 'GLOB') ? readGlob(need('GLOB')) : [],
    sounds: opt('SOND', readSond),
    audioGroups: opt('AGRP', readAgrp),
    audio: opt('AUDO', readAudo),
    tilesets: opt('BGND', readBgnd),
    paths: opt('PATH', readPath),
    animcurves: opt('ACRV', readAcrv),
    shaders: opt('SHDR', readShdr),
  };
}
