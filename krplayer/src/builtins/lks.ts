// Looks (lks_*) and sound (snd_*).

import { define, family, n, b, str, opt } from './registry.ts';
import { GmlError, real } from '../value.ts';
import { spriteOrThrow } from '../runtime/draw.ts';
import type { SpriteDef } from '../runtime/assets.ts';

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
    width: w, height: h, ox: n(s, t, 7), oy: n(s, t, 8), bbox: [0, 0, w - 1, h - 1], maskKind: 0, fpsDiv: true, speed: 0,
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
