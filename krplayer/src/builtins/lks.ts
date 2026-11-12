// Looks (lks_*) and sound (snd_*).

import { define, family, n, b, str, opt } from './registry.ts';
import { NotImplemented, real, Unverified } from '../value.ts';
import { spriteOrThrow } from '../runtime/draw.ts';
import type { SpriteDef } from '../runtime/assets.ts';
import { Files } from '../runtime/data.ts';
import type { Game } from '../runtime/game.ts';
import type { Pixels } from '../platform/types.ts';
import { DsMap } from '../runtime/data.ts';
import { newEmitter, type Emitter } from '../runtime/sound.ts';

const SPRITE_INFO: Record<string, true> = { width: true, height: true, number: true, xoffset: true, yoffset: true };
define('lks_sprite_info', (g, s, t) => {
  const sp = g.a.sprites[n(s, t, 1)];
  if (!sp) { if (String(s[t]) in SPRITE_INFO) return 0; } // GM: 0 for a missing sprite (error_audit.md)
  else switch (s[t]) {
    case 'width': return sp.width; case 'height': return sp.height; case 'number': return sp.frames.length;
    case 'xoffset': return sp.ox; case 'yoffset': return sp.oy;
  }
  throw new NotImplemented(`sprite_get_${String(s[t])} unknown`);
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
  if (!g.p.decodeImage) throw new NotImplemented(`${fn}: this platform can't decode image files`);
  // smooth only does anything with removeback (it softens the cut-out edges).
  if (removeback && smooth) throw new NotImplemented(`${fn}: smooth is not implemented in krplayer yet`);
  const img = g.a.images.get(Files.norm(path)) ?? null;
  if (!img) g.p.log(`${fn}: ${path} is not an included image file`);
  return img && removeback ? removeBack(img) : img;
}

/** removeback: a copy with every pixel of the bottom-left pixel's colour made fully transparent. */
function removeBack(img: Pixels): Pixels {
  const d = new Uint8ClampedArray(img.data), k = (img.h - 1) * img.w * 4, r = d[k], gr = d[k + 1], bl = d[k + 2];
  for (let i = 0; i < d.length; i += 4) if (d[i] === r && d[i + 1] === gr && d[i + 2] === bl) d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
  return { w: img.w, h: img.h, data: d };
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
  if (!ts) throw new Unverified(`background_replace: background ${n(s, t, 0)} does not exist`);
  const img = imageFile(g, 'background_replace', str(s, t, 1), b(s, t, 2), b(s, t, 3));
  if (img) ts.tex = g.p.renderer.createTexture(img);
  return undefined;
});
define('lks_sprite_assign', (g, s, t) => {
  const dst = spriteOrThrow(g, n(s, t, 0)), src = spriteOrThrow(g, n(s, t, 1));
  Object.assign(dst, { ...src, index: dst.index, name: dst.name, frames: [...src.frames], bbox: [...src.bbox] });
  return undefined;
});
define('lks_sprite_set_offset', (g, s, t) => { const sp = g.a.sprites[n(s, t, 0)]; if (!sp) return undefined; sp.ox = n(s, t, 1); sp.oy = n(s, t, 2); return undefined; });
const BBOX: Record<string, number> = { left: 0, top: 1, right: 2, bottom: 3 };
define('lks_sprite_bbox', (g, s, t) => g.a.sprites[n(s, t, 1)]?.bbox[BBOX[String(s[t])]] ?? 0);
define('lks_sprite_set_bbox', (g, s, t) => { spriteOrThrow(g, n(s, t, 0)).bbox = [n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4)]; return undefined; });
/** sprite_duplicate: a new sprite sharing the frames (textures are never changed in place). */
define('lks_sprite_duplicate', (g, s, t) => {
  const sp = spriteOrThrow(g, n(s, t, 0)), i = g.a.sprites.length;
  g.a.sprites.push({ ...sp, index: i, name: `__newsprite${i}`, frames: [...sp.frames], bbox: [...sp.bbox] });
  return i;
});
/** Every frame is a whole texture of its own, so its UVs cover the texture (untrimmed: no offsets). */
define('lks_sprite_uvs', (g, s, t) => { spriteOrThrow(g, n(s, t, 0)); return [0, 0, 1, 1, 0, 0, 1, 1]; });
/** sprite_collision_mask(spr, sepmasks, bboxmode, l, t, r, b, kind, tolerance). kind: 0 precise, 1 rectangle, 2 ellipse, 3 diamond. */
define('lks_sprite_collision_mask', (g, s, t) => {
  const sp = spriteOrThrow(g, n(s, t, 0)), sep = b(s, t, 1), mode = n(s, t, 2), kind = n(s, t, 7), tol = n(s, t, 8);
  const w = sp.width, h = sp.height, px = sp.pixels;
  if (kind === 0 && !px) throw new NotImplemented(`sprite_collision_mask: precise masks need pixels, which krplayer only keeps for sprite_add sprites (${sp.name})`);
  sp.bbox = mode === 0 ? (px ? autoBBox(px, tol) : sp.bbox) : mode === 1 ? [0, 0, w - 1, h - 1] : [n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6)];
  if (kind === 1) { Object.assign(sp, { maskKind: 0, bits: null, nBits: 0, stride: 0 }); return undefined; }
  if (kind < 0 || kind > 3) throw new Unverified(`sprite_collision_mask: unknown mask kind ${kind}`);
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
  if (!g.p.fonts) throw new NotImplemented("font_add: this platform can't rasterize fonts");
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
// Positional audio follows GM's HTML5 runner: WebAudio panning, no falloff until audio_falloff_set_model, no Doppler.
/** audio_play_sound_at(sound, x, y, z, falloff_ref, falloff_max, falloff_factor, loop, priority, [gain, offset, pitch]) */
define('snd_play_at', (g, s, t, argc) => g.snd.play(target(s[t]), b(s, t, 7), opt(s, t, 9, argc, 1), opt(s, t, 10, argc, 0), opt(s, t, 11, argc, 1),
  newEmitter(n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6))));
/** audio_play_sound_on(emitter, sound, loop, priority, [gain, offset, pitch]); a missing emitter plays nothing (-1). */
define('snd_play_on', (g, s, t, argc) => {
  const e = g.snd.emitters[n(s, t, 0)];
  return e ? g.snd.play(target(s[t - 1]), b(s, t, 2), opt(s, t, 4, argc, 1), opt(s, t, 5, argc, 0), opt(s, t, 6, argc, 1), e) : -1;
});
/** An emitter member: does nothing (and gives dflt) on a missing emitter. */
const em = (dflt: number, f: (e: Emitter, s: unknown[], t: number, g: Game) => number | void) => (g: Game, s: unknown[], t: number) => {
  const e = g.snd.emitters[real(s[t] as number)];
  return e ? f(e, s, t, g) ?? undefined : dflt;
};
const emSet = (f: (e: Emitter, s: unknown[], t: number) => void) => em(0, (e, s, t, g) => { f(e, s, t); g.snd.emitterChanged(e); });
const num = (s: unknown[], t: number, k: number) => real(s[t - k] as number);
/** Listener values from index k of Sounds.listener; set_* variants take a listener index first (only listener 0 exists). */
const listen = (k: number, count: number, indexed: boolean) => (g: Game, s: unknown[], t: number) => {
  if (indexed && num(s, t, 0) !== 0) return undefined;
  for (let i = 0; i < count; i++) g.snd.listener[k + i] = num(s, t, i + (indexed ? 1 : 0));
  g.snd.listenerChanged();
  return undefined;
};
family('snd_3d', 'audio_', {
  emitter_create: (g) => { const l = g.snd.emitters, free = l.indexOf(null), i = free < 0 ? l.length : free; l[i] = newEmitter(); return i; },
  emitter_free: (g, s, t) => { g.snd.freeEmitter(n(s, t, 0)); return undefined; },
  emitter_exists: (g, s, t) => !!g.snd.emitters[n(s, t, 0)],
  emitter_position: emSet((e, s, t) => { e.x = num(s, t, 1); e.y = num(s, t, 2); e.z = num(s, t, 3); }),
  emitter_velocity: em(0, () => {}), // Doppler: WebAudio has none
  emitter_falloff: emSet((e, s, t) => { e.ref = num(s, t, 1); e.max = num(s, t, 2); e.factor = num(s, t, 3); }),
  emitter_gain: emSet((e, s, t) => { e.gain = Math.max(0, num(s, t, 1)); }),
  emitter_pitch: emSet((e, s, t) => { e.pitch = num(s, t, 1); }),
  emitter_get_x: em(0, (e) => e.x), emitter_get_y: em(0, (e) => e.y), emitter_get_z: em(0, (e) => e.z),
  emitter_get_gain: em(0, (e) => e.gain), emitter_get_pitch: em(1, (e) => e.pitch),
  listener_position: listen(0, 3, false), listener_velocity: listen(3, 3, false), listener_orientation: listen(6, 6, false),
  listener_set_position: listen(0, 3, true), listener_set_velocity: listen(3, 3, true), listener_set_orientation: listen(6, 6, true),
  listener_get_data: (g, s, t) => {
    if (n(s, t, 0) !== 0) return -1;
    const m = new DsMap();
    ['x', 'y', 'z', 'vx', 'vy', 'vz', 'lookat_x', 'lookat_y', 'lookat_z', 'up_x', 'up_y', 'up_z'].forEach((k, i) => m.m.set(k, g.snd.listener[i]));
    return g.data.maps.add(m);
  },
  falloff_set_model: (g, s, t) => {
    const m = Math.trunc(n(s, t, 0));
    if (m >= 0 && m <= 8) { g.snd.falloff = m; g.snd.emitterChanged(null); } // an unknown model is ignored (HTML5 runner)
    return undefined;
  },
});
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

define('lks_sprite_prefetch', () => 0);
define('snd_exists', (g, s, t) => typeof s[t] === 'number' && g.snd.exists(s[t] as number));
define('snd_name', (g, s, t) => g.snd.name(real(s[t])));
