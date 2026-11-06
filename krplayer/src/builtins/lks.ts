// Looks (lks_*) and sound (snd_*).

import { define, family, n, b, str, opt } from './registry.ts';
import { GmlError, real } from '../value.ts';
import { spriteOrThrow } from '../runtime/draw.ts';
import type { SpriteDef } from '../runtime/assets.ts';
import { Files } from '../runtime/data.ts';
import type { Game } from '../runtime/game.ts';
import type { Pixels } from '../platform/types.ts';

define('lks_sprite_info', (g, s, t) => {
  const sp = spriteOrThrow(g, n(s, t, 1));
  switch (s[t]) {
    case 'width': return sp.width; case 'height': return sp.height; case 'number': return sp.frames.length;
    case 'xoffset': return sp.ox; case 'yoffset': return sp.oy;
  }
  throw new GmlError(`sprite_get_${String(s[t])} unknown`);
});
define('lks_sprite_name', (g, s, t) => g.a.sprites[n(s, t, 0)]?.name ?? '<undefined>');
define('lks_sprite_exists', (g, s, t) => typeof s[t] === 'number' && !!g.a.sprites[s[t] as number]);
define('lks_asset_named', (g, s, t) => g.a.assetIndex.get(str(s, t, 0)) ?? -1);
define('lks_sprite_from_surface', (g, s, t) => {
  const sf = g.surface(s[t]), x = n(s, t, 1), y = n(s, t, 2), w = n(s, t, 3), h = n(s, t, 4);
  const sp: SpriteDef = {
    index: g.a.sprites.length, name: `__newsprite${g.a.sprites.length}`, frames: [g.p.renderer.copyTexture(sf.tex, x, y, w, h)],
    width: w, height: h, ox: n(s, t, 7), oy: n(s, t, 8), bbox: [0, 0, w - 1, h - 1], maskKind: 0, bits: null, nBits: 0, stride: 0, fpsDiv: true, speed: 0,
  };
  g.a.sprites.push(sp);
  return sp.index;
});
define('lks_sprite_delete', (g, s, t) => {
  const i = n(s, t, 0), sp = g.a.sprites[i];
  if (sp && sp.name.startsWith('__newsprite')) { for (const f of sp.frames) g.p.renderer.freeSurface(f); (g.a.sprites as (SpriteDef | undefined)[])[i] = undefined; }
  return undefined;
});
/** font_add_sprite_ext: glyphs are the sprite's frames, mapped to the characters of string_map in order. */
define('lks_font_from_sprite', (g, s, t) => {
  const sp = spriteOrThrow(g, n(s, t, 0)), map = str(s, t, 1), sep = n(s, t, 3);
  const glyphs = new Map<number, readonly number[]>();
  [...map].forEach((c, i) => { if (i < sp.frames.length) glyphs.set(c.codePointAt(0)!, [i, 0, sp.width, sp.height, sp.width + sep, 0]); });
  g.a.fonts.push({ index: g.a.fonts.length, name: `__sprite_font${g.a.fonts.length}`, tex: sp.frames[0] ?? -1, lineHeight: sp.height, glyphs, sprite: sp, sep, proportional: b(s, t, 2) });
  return g.a.fonts.length - 1;
});

// ---------------------------------------------------------------- runtime sprites from image files

/** An included image file (decoded at load), or null if the game doesn't ship it. */
function imageFile(g: Game, fn: string, path: string, removeback: boolean, smooth: boolean): Pixels | null {
  if (!g.p.decodeImage) throw new GmlError(`${fn}: this platform can't decode image files`);
  if (removeback || smooth) throw new GmlError(`${fn}: removeback/smooth are not implemented in krplayer yet`);
  const img = g.a.images.get(Files.norm(path)) ?? null;
  if (!img) g.p.log(`${fn}: ${path} is not an included image file`);
  return img;
}

function crop(img: Pixels, x: number, y: number, w: number, h: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) data.set(img.data.subarray(((y + j) * img.w + x) * 4, ((y + j) * img.w + x + w) * 4), j * w * 4);
  return { w, h, data };
}

/** Tight box around pixels with alpha > tol over all frames (the whole frame if none). */
function autoBBox(frames: Pixels[], tol: number): [number, number, number, number] {
  const { w, h } = frames[0];
  let l = w, t = h, r = -1, b = -1;
  for (const f of frames) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (f.data[(y * w + x) * 4 + 3] > tol) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
  }
  return r < 0 ? [0, 0, w - 1, h - 1] : [l, t, r, b];
}

/**
 * Makes sp an image strip of n frames (GM: frame width = image width / n), rectangle mask with an automatic
 * bbox, animating one frame per step (assumed GM defaults for sprite_add; see gm_gotchas.md).
 */
function fromStrip(g: Game, sp: SpriteDef, img: Pixels, n: number, ox: number, oy: number): SpriteDef {
  const count = Math.max(1, Math.trunc(n)), w = Math.max(1, Math.floor(img.w / count)), pixels: Pixels[] = [];
  for (let i = 0; i < count; i++) pixels.push(crop(img, Math.min(i * w, img.w - w), 0, w, img.h));
  Object.assign(sp, {
    frames: pixels.map((p) => g.p.renderer.createTexture(p)), pixels, width: w, height: img.h, ox, oy,
    bbox: autoBBox(pixels, 0), maskKind: 0, bits: null, nBits: 0, stride: 0, fpsDiv: false, speed: 1,
  });
  return sp;
}

define('lks_sprite_add', (g, s, t) => {
  const img = imageFile(g, 'sprite_add', str(s, t, 0), b(s, t, 2), b(s, t, 3));
  if (!img) return -1;
  const i = g.a.sprites.length, sp = { index: i, name: `__newsprite${i}` } as SpriteDef;
  g.a.sprites.push(fromStrip(g, sp, img, n(s, t, 1), n(s, t, 4), n(s, t, 5)));
  return i;
});
define('lks_sprite_replace', (g, s, t) => {
  const sp = spriteOrThrow(g, n(s, t, 0)), img = imageFile(g, 'sprite_replace', str(s, t, 1), b(s, t, 3), b(s, t, 4));
  if (img) fromStrip(g, sp, img, n(s, t, 2), n(s, t, 5), n(s, t, 6));
  return undefined;
});
/** GMS1 backgrounds are tilesets in GMS2 builds: the tileset's image is replaced, its tile layout kept. */
define('lks_tileset_replace', (g, s, t) => {
  const ts = g.a.tilesets[n(s, t, 0)];
  if (!ts) throw new GmlError(`background_replace: background ${n(s, t, 0)} does not exist`);
  const img = imageFile(g, 'background_replace', str(s, t, 1), b(s, t, 2), b(s, t, 3));
  if (img) ts.tex = g.p.renderer.createTexture(img);
  return undefined;
});
define('lks_sprite_assign', (g, s, t) => {
  const dst = spriteOrThrow(g, n(s, t, 0)), src = spriteOrThrow(g, n(s, t, 1));
  Object.assign(dst, { ...src, index: dst.index, name: dst.name, frames: [...src.frames], bbox: [...src.bbox] });
  return undefined;
});
define('lks_sprite_set_offset', (g, s, t) => { const sp = spriteOrThrow(g, n(s, t, 0)); sp.ox = n(s, t, 1); sp.oy = n(s, t, 2); return undefined; });
/** sprite_collision_mask(spr, sepmasks, bboxmode, l, t, r, b, kind, tolerance). kind: 0 precise, 1 rectangle, 2 ellipse, 3 diamond. */
define('lks_sprite_collision_mask', (g, s, t) => {
  const sp = spriteOrThrow(g, n(s, t, 0)), sep = b(s, t, 1), mode = n(s, t, 2), kind = n(s, t, 7), tol = n(s, t, 8);
  const w = sp.width, h = sp.height, px = sp.pixels;
  if (kind === 0 && !px) throw new GmlError(`sprite_collision_mask: precise masks need pixels, which krplayer only keeps for sprite_add sprites (${sp.name})`);
  sp.bbox = mode === 0 ? (px ? autoBBox(px, tol) : sp.bbox) : mode === 1 ? [0, 0, w - 1, h - 1] : [n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6)];
  if (kind === 1) { Object.assign(sp, { maskKind: 0, bits: null, nBits: 0, stride: 0 }); return undefined; }
  if (kind < 0 || kind > 3) throw new GmlError(`sprite_collision_mask: unknown mask kind ${kind}`);
  const [l, tp, r, bt] = sp.bbox, cx = (l + r) / 2, cy = (tp + bt) / 2, rx = (r - l + 1) / 2, ry = (bt - tp + 1) / 2;
  const stride = (w + 7) >> 3, masks = kind === 0 && sep ? sp.frames.length : 1, bits = new Uint8Array(stride * h * masks);
  for (let m = 0; m < masks; m++) for (let y = Math.max(0, tp); y <= Math.min(h - 1, bt); y++) for (let x = Math.max(0, l); x <= Math.min(w - 1, r); x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
    const on = kind === 2 ? dx * dx + dy * dy <= 1 : kind === 3 ? Math.abs(dx) + Math.abs(dy) <= 1
      : (sep ? [px![m]] : px!).some((f) => f.data[(y * w + x) * 4 + 3] > tol);
    if (on) bits[m * stride * h + y * stride + (x >> 3)] |= 0x80 >> (x & 7);
  }
  Object.assign(sp, { maskKind: 2, bits, nBits: masks, stride });
  return undefined;
});
/** The frame's texture handle (only useful to vertex_submit / shaders). */
define('lks_sprite_texture', (g, s, t) => spriteOrThrow(g, n(s, t, 0)).frames[Math.trunc(n(s, t, 1))] ?? -1);
/** font_add from an included TTF/OTF. GM sizes are points at 96 DPI (a 12pt font has 16px glyph cells). */
define('lks_font_add', (g, s, t) => {
  if (!g.p.fonts) throw new GmlError("font_add: this platform can't rasterize fonts");
  const path = str(s, t, 0), id = g.a.fontFiles.get(Files.norm(path));
  if (id === undefined || id < 0) { g.p.log(`font_add: ${path} is not an included font file`); return -1; }
  const { atlas, glyphs, lineHeight } = g.p.fonts.raster(id, (n(s, t, 1) * 96) / 72, b(s, t, 2), b(s, t, 3), Math.trunc(n(s, t, 4)), Math.trunc(n(s, t, 5)), true);
  const map = new Map<number, readonly number[]>();
  for (const [c, ...rest] of glyphs) map.set(c, rest);
  const i = g.a.fonts.length;
  g.a.fonts.push({ index: i, name: `__newfont${i}`, tex: g.p.renderer.createTexture(atlas), lineHeight, glyphs: map });
  return i;
});

// ---------------------------------------------------------------- sound

const target = (v: unknown) => Math.trunc(real(v as number));

define('snd_play', (g, s, t, argc) => g.snd.play(target(s[t]), b(s, t, 2), opt(s, t, 3, argc, 1), opt(s, t, 4, argc, 0), opt(s, t, 5, argc, 1)));
define('snd_stop', (g, s, t) => { g.snd.stop(target(s[t])); return undefined; });
define('snd_stop_all', (g) => { g.snd.stopAll(); return undefined; });
define('snd_pause', (g, s, t) => { g.snd.pause(target(s[t - 1]), s[t] === 'pause'); return undefined; });
define('snd_pause_all', (g, s, t) => { g.snd.pauseAll(s[t] === 'pause'); return undefined; });
define('snd_is', (g, s, t) => (s[t] === 'playing' ? g.snd.isPlaying(target(s[t - 1])) : g.snd.isPaused(target(s[t - 1]))));
define('snd_gain', (g, s, t) => { g.snd.setGain(target(s[t]), n(s, t, 1), n(s, t, 2)); return undefined; });
define('snd_pitch', (g, s, t) => { g.snd.setPitch(target(s[t]), n(s, t, 1)); return undefined; });
define('snd_get', (g, s, t) => (s[t] === 'gain' ? g.snd.getGain(target(s[t - 1])) : g.snd.getPitch(target(s[t - 1]))));
define('snd_master_gain', (g, s, t) => { g.snd.setMaster(n(s, t, 0)); return undefined; });
define('snd_set_master_gain', (g, s, t) => { g.snd.setMaster(n(s, t, 1)); return undefined; });
define('snd_position', (g, s, t) => g.snd.position(target(s[t])));
define('snd_seek', (g, s, t) => { g.snd.seek(target(s[t]), n(s, t, 1)); return undefined; });
define('snd_length', (g, s, t) => g.snd.length(target(s[t])));
define('snd_loop', (g, s, t) => { if (s[t] === 'enabled') g.snd.setLoop(target(s[t - 1]), b(s, t, 2)); return undefined; });
define('snd_stream_create', (g, s, t) => {
  const path = str(s, t, 0), key = path.replaceAll('\\', '/').toLowerCase().replace(/^(\.\/)+/, '');
  const url = g.a.fileUrls.get(key);
  if (!url) { g.p.log(`audio_create_stream: ${path} is not an included file`); return -1; }
  return g.snd.createStream(url, path);
});
define('snd_stream_destroy', (g, s, t) => { g.snd.destroyStream(target(s[t])); return undefined; });
// Audio groups are loading hints: everything is loaded.
family('snd_group', 'audio_group_', {
  load: () => true, unload: () => true, is_loaded: () => true, load_progress: () => 100,
  set_gain: (g, s, t) => { g.snd.setGroupGain(n(s, t, 0), n(s, t, 1), n(s, t, 2)); return undefined; },
  stop_all: () => undefined,
});
