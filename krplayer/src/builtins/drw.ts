// Drawing (drw_*).

import { define, family, n, b, str, opt } from './registry.ts';
import { GmlError, real } from '../value.ts';
import { Instance } from '../runtime/instance.ts';
import type { Game } from '../runtime/game.ts';
import {
  drawSprite, drawSpriteGeneral, drawSpritePart, drawSpriteTiled, drawText, ellipse, line, mix, rect, roundrect, spriteOrThrow, textSize, triangle,
} from '../runtime/draw.ts';
import { gstr } from './opr.ts';

const spr = (g: Game, v: unknown) => spriteOrThrow(g, real(v as number));
const a = (g: Game) => g.alpha;

define('drw_self', (g) => { if (g.self instanceof Instance) g.drawSelf(g.self); return undefined; });
define('drw_sprite', (g, s, t) => {
  const sp = spr(g, s[t]), f = n(s, t, 1);
  const img = f < 0 && g.self instanceof Instance ? g.self.image_index : f;
  drawSprite(g, sp, img, n(s, t, 2), n(s, t, 3), 1, 1, 0, 0xffffff, a(g));
  return undefined;
});
define('drw_sprite_ext', (g, s, t) => {
  const sp = spr(g, s[t]), f = n(s, t, 1);
  const img = f < 0 && g.self instanceof Instance ? g.self.image_index : f;
  drawSprite(g, sp, img, n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7), n(s, t, 8));
  return undefined;
});
define('drw_sprite_stretched', (g, s, t) => {
  const sp = spr(g, s[t]);
  drawSpriteGeneral(g, sp, n(s, t, 1), 0, 0, sp.width, sp.height, n(s, t, 2), n(s, t, 3), n(s, t, 4) / sp.width, n(s, t, 5) / sp.height, 0, 0xffffff, 0xffffff, 0xffffff, 0xffffff, a(g));
  return undefined;
});
define('drw_sprite_stretched_ext', (g, s, t) => {
  const sp = spr(g, s[t]), c = n(s, t, 6);
  drawSpriteGeneral(g, sp, n(s, t, 1), 0, 0, sp.width, sp.height, n(s, t, 2), n(s, t, 3), n(s, t, 4) / sp.width, n(s, t, 5) / sp.height, 0, c, c, c, c, n(s, t, 7));
  return undefined;
});
define('drw_sprite_part', (g, s, t) => {
  drawSpritePart(g, spr(g, s[t]), n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7), 1, 1, 0xffffff, a(g));
  return undefined;
});
define('drw_sprite_part_ext', (g, s, t) => {
  drawSpritePart(g, spr(g, s[t]), n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7), n(s, t, 8), n(s, t, 9), n(s, t, 10), n(s, t, 11));
  return undefined;
});
define('drw_sprite_general', (g, s, t) => {
  drawSpriteGeneral(g, spr(g, s[t]), n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7), n(s, t, 8), n(s, t, 9), n(s, t, 10),
    n(s, t, 11), n(s, t, 12), n(s, t, 13), n(s, t, 14), n(s, t, 15));
  return undefined;
});
define('drw_sprite_pos', (g, s, t) => {
  const sp = spr(g, s[t]), f = Math.floor(n(s, t, 1));
  g.p.renderer.drawQuad(sp.frames[((f % sp.frames.length) + sp.frames.length) % sp.frames.length], 0, 0, sp.width, sp.height,
    n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7), n(s, t, 8), n(s, t, 9), 0xffffff, 0xffffff, 0xffffff, 0xffffff, n(s, t, 10));
  return undefined;
});
define('drw_sprite_tiled', (g, s, t) => { drawSpriteTiled(g, spr(g, s[t]), n(s, t, 1), n(s, t, 2), n(s, t, 3), 1, 1, 0xffffff, a(g)); return undefined; });
define('drw_sprite_tiled_ext', (g, s, t) => {
  drawSpriteTiled(g, spr(g, s[t]), n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7));
  return undefined;
});
define('drw_path', () => { throw new GmlError('draw_path: the project has no paths'); });

// ---------------------------------------------------------------- text

const text = (g: Game, x: number, y: number, v: unknown, xs = 1, ys = 1, ang = 0, sep = -1, w = -1, c1 = g.colour, c2 = c1, c3 = c1, c4 = c1, alpha = g.alpha) =>
  drawText(g, x, y, gstr(g, v as never), xs, ys, ang, sep, w, c1, c2, c3, c4, alpha);
define('drw_text', (g, s, t) => { text(g, n(s, t, 0), n(s, t, 1), s[t - 2]); return undefined; });
define('drw_text_ext', (g, s, t) => { text(g, n(s, t, 0), n(s, t, 1), s[t - 2], 1, 1, 0, n(s, t, 3), n(s, t, 4)); return undefined; });
define('drw_text_transformed', (g, s, t) => { text(g, n(s, t, 0), n(s, t, 1), s[t - 2], n(s, t, 3), n(s, t, 4), n(s, t, 5)); return undefined; });
define('drw_text_ext_transformed', (g, s, t) => {
  text(g, n(s, t, 0), n(s, t, 1), s[t - 2], n(s, t, 5), n(s, t, 6), n(s, t, 7), n(s, t, 3), n(s, t, 4));
  return undefined;
});
define('drw_text_colour', (g, s, t) => {
  text(g, n(s, t, 0), n(s, t, 1), s[t - 2], 1, 1, 0, -1, -1, n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7));
  return undefined;
});
define('drw_text_ext_colour', (g, s, t) => {
  text(g, n(s, t, 0), n(s, t, 1), s[t - 2], 1, 1, 0, n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7), n(s, t, 8), n(s, t, 9));
  return undefined;
});
define('drw_text_transformed_colour', (g, s, t) => {
  text(g, n(s, t, 0), n(s, t, 1), s[t - 2], n(s, t, 3), n(s, t, 4), n(s, t, 5), -1, -1, n(s, t, 6), n(s, t, 7), n(s, t, 8), n(s, t, 9), n(s, t, 10));
  return undefined;
});
define('drw_text_size', (g, s, t) => textSize(g, gstr(g, s[t - 1]))[s[t] === 'width' ? 0 : 1]);
define('drw_set_font', (g, s, t) => {
  const f = real(s[t]);
  if (f !== -1 && !g.a.fonts[f]) throw new GmlError(`font ${f} does not exist`);
  g.font = f; return undefined;
});
define('drw_set_colour', (g, s, t) => { g.colour = n(s, t, 0); return undefined; });
define('drw_set_alpha', (g, s, t) => { g.alpha = n(s, t, 0); return undefined; });
define('drw_set_align', (g, s, t) => { if (s[t] === 'h') g.halign = n(s, t, 1); else g.valign = n(s, t, 1); return undefined; });
define('drw_get', (g, s, t) => {
  switch (s[t]) {
    case 'colour': return g.colour; case 'alpha': return g.alpha; case 'font': return g.font;
    case 'halign': return g.halign; case 'valign': return g.valign;
  }
  throw new GmlError(`draw_get_${String(s[t])} unknown`);
});

// ---------------------------------------------------------------- shapes

define('drw_rect', (g, s, t) => { const c = g.colour; rect(g, n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), c, c, c, c, g.alpha, b(s, t, 4)); return undefined; });
define('drw_rect_colour', (g, s, t) => {
  rect(g, n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7), g.alpha, b(s, t, 8));
  return undefined;
});
define('drw_roundrect', (g, s, t) => { roundrect(g, n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), 4, 4, g.colour, g.colour, g.alpha, b(s, t, 4)); return undefined; });
define('drw_roundrect_ext', (g, s, t) => { roundrect(g, n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4) / 2, n(s, t, 5) / 2, g.colour, g.colour, g.alpha, b(s, t, 6)); return undefined; });
define('drw_roundrect_colour', (g, s, t) => { roundrect(g, n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), 4, 4, n(s, t, 4), n(s, t, 5), g.alpha, b(s, t, 6)); return undefined; });
define('drw_roundrect_colour_ext', (g, s, t) => {
  roundrect(g, n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4) / 2, n(s, t, 5) / 2, n(s, t, 6), n(s, t, 7), g.alpha, b(s, t, 8));
  return undefined;
});
define('drw_circle', (g, s, t) => { const r = n(s, t, 2); ellipse(g, n(s, t, 0), n(s, t, 1), r, r, g.colour, g.colour, g.alpha, b(s, t, 3)); return undefined; });
define('drw_circle_colour', (g, s, t) => { const r = n(s, t, 2); ellipse(g, n(s, t, 0), n(s, t, 1), r, r, n(s, t, 3), n(s, t, 4), g.alpha, b(s, t, 5)); return undefined; });
const ell = (g: Game, x1: number, y1: number, x2: number, y2: number, c1: number, c2: number, o: boolean) =>
  ellipse(g, (x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, c1, c2, g.alpha, o);
define('drw_ellipse', (g, s, t) => { ell(g, n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), g.colour, g.colour, b(s, t, 4)); return undefined; });
define('drw_ellipse_colour', (g, s, t) => { ell(g, n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), b(s, t, 6)); return undefined; });
define('drw_line', (g, s, t, argc) => { line(g, n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), opt(s, t, 4, argc, 1), g.colour, g.colour, g.alpha); return undefined; });
define('drw_line_colour', (g, s, t) => { line(g, n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), 1, n(s, t, 4), n(s, t, 5), g.alpha); return undefined; });
define('drw_line_width_colour', (g, s, t) => { line(g, n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), g.alpha); return undefined; });
define('drw_point', (g, s, t) => { const c = g.colour; rect(g, n(s, t, 0), n(s, t, 1), n(s, t, 0), n(s, t, 1), c, c, c, c, g.alpha, false); return undefined; });
define('drw_point_colour', (g, s, t) => { const c = n(s, t, 2); rect(g, n(s, t, 0), n(s, t, 1), n(s, t, 0), n(s, t, 1), c, c, c, c, g.alpha, false); return undefined; });
define('drw_triangle', (g, s, t) => {
  const c = g.colour;
  triangle(g, n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), c, c, c, g.alpha, b(s, t, 6));
  return undefined;
});
define('drw_triangle_colour', (g, s, t) => {
  triangle(g, n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7), n(s, t, 8), g.alpha, b(s, t, 9));
  return undefined;
});
define('drw_arrow', (g, s, t) => {
  const x1 = n(s, t, 0), y1 = n(s, t, 1), x2 = n(s, t, 2), y2 = n(s, t, 3), size = n(s, t, 4), c = g.colour;
  line(g, x1, y1, x2, y2, 1, c, c, g.alpha);
  const d = Math.atan2(y2 - y1, x2 - x1);
  triangle(g, x2, y2, x2 - size * Math.cos(d - 0.5), y2 - size * Math.sin(d - 0.5), x2 - size * Math.cos(d + 0.5), y2 - size * Math.sin(d + 0.5), c, c, c, g.alpha, false);
  return undefined;
});
define('drw_healthbar', (g, s, t) => {
  const x1 = n(s, t, 0), y1 = n(s, t, 1), x2 = n(s, t, 2), y2 = n(s, t, 3), amt = Math.max(0, Math.min(100, n(s, t, 4))) / 100;
  if (b(s, t, 9)) { const bc = n(s, t, 5); rect(g, x1, y1, x2, y2, bc, bc, bc, bc, g.alpha, false); }
  const c = mix(n(s, t, 6), n(s, t, 7), amt), dir = n(s, t, 8);
  const [l, tp, r, bt] = dir === 0 ? [x1, y1, x1 + (x2 - x1) * amt, y2] : dir === 1 ? [x2 - (x2 - x1) * amt, y1, x2, y2] : dir === 2 ? [x1, y1, x2, y1 + (y2 - y1) * amt] : [x1, y2 - (y2 - y1) * amt, x2, y2];
  if (amt > 0) rect(g, l, tp, r, bt, c, c, c, c, g.alpha, false);
  if (b(s, t, 10)) rect(g, x1, y1, x2, y2, 0, 0, 0, 0, g.alpha, true);
  return undefined;
});
define('drw_clear', (g, s, t, argc) => { g.p.renderer.clear(n(s, t, 0), opt(s, t, 1, argc, 1)); return undefined; });

// ---------------------------------------------------------------- colours

define('drw_make_colour', (_g, s, t) => {
  const x = n(s, t, 1), y = n(s, t, 2), z = n(s, t, 3);
  if (s[t] === 'rgb') return (clamp8(x)) | (clamp8(y) << 8) | (clamp8(z) << 16);
  // GM HSV components are 0-255.
  const h = (x / 255) * 6, sa = y / 255, v = z / 255, i = Math.floor(h) % 6, f = h - Math.floor(h);
  const p = v * (1 - sa), q = v * (1 - f * sa), u = v * (1 - (1 - f) * sa);
  const [r, gg, bb] = [[v, u, p], [q, v, p], [p, v, u], [p, q, v], [u, p, v], [v, p, q]][i];
  return clamp8(r * 255) | (clamp8(gg * 255) << 8) | (clamp8(bb * 255) << 16);
});
const clamp8 = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
define('drw_merge_colour', (_g, s, t) => mix(n(s, t, 0), n(s, t, 1), Math.max(0, Math.min(1, n(s, t, 2)))));
define('drw_colour_get', (_g, s, t) => {
  const c = n(s, t, 1), r = c & 255, gg = (c >> 8) & 255, bb = (c >> 16) & 255, max = Math.max(r, gg, bb), min = Math.min(r, gg, bb);
  switch (s[t]) {
    case 'red': return r; case 'green': return gg; case 'blue': return bb; case 'value': return max;
    case 'saturation': return max === 0 ? 0 : Math.round(((max - min) / max) * 255);
    case 'hue': {
      if (max === min) return 0;
      const d = max - min, h = max === r ? (gg - bb) / d : max === gg ? 2 + (bb - r) / d : 4 + (r - gg) / d;
      return Math.round((((h / 6) % 1) + 1) % 1 * 255);
    }
  }
  throw new GmlError(`colour_get_${String(s[t])} unknown`);
});

// ---------------------------------------------------------------- GPU state

/** bm_normal 0, bm_add 1, bm_max 2, bm_subtract 3 -> factor pairs (GM bm_* factor constants). */
const BLEND: Record<number, [number, number]> = { 0: [5, 6], 1: [5, 2], 2: [5, 4], 3: [1, 4] };
define('drw_blendmode', (g, s, t) => {
  const m = BLEND[n(s, t, 0)];
  if (!m) throw new GmlError(`blend mode ${n(s, t, 0)} not supported`);
  g.p.renderer.setBlend(m[0], m[1], m[0], m[1]);
  return undefined;
});
family('drw_gpu', 'gpu_set_', {
  blendmode_ext: (g, s, t) => { g.p.renderer.setBlend(n(s, t, 0), n(s, t, 1), n(s, t, 0), n(s, t, 1)); return undefined; },
  blendmode_ext_sepalpha: (g, s, t) => { g.p.renderer.setBlend(n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3)); return undefined; },
  blendenable: (g, s, t) => { if (b(s, t, 0)) g.p.renderer.setBlend(5, 6, 5, 6); else g.p.renderer.setBlend(2, 1, 2, 1); return undefined; },
  fog: (g, s, t) => { g.p.renderer.setFog(b(s, t, 0), n(s, t, 1)); return undefined; },
  texfilter: (g, s, t) => { g.p.renderer.setFilter(b(s, t, 0)); return undefined; },
  colorwriteenable: (g, s, t) => { g.p.renderer.setColorWrite(b(s, t, 0), b(s, t, 1), b(s, t, 2), b(s, t, 3)); return undefined; },
  colourwriteenable: (g, s, t) => { g.p.renderer.setColorWrite(b(s, t, 0), b(s, t, 1), b(s, t, 2), b(s, t, 3)); return undefined; },
  alphatestenable: () => undefined, alphatestref: () => undefined, ztestenable: () => undefined, zwriteenable: () => undefined, cullmode: () => undefined,
});
// Texture pages are a desktop concern: everything is resident in krplayer.
family('drw_texture', 'texture_', { prefetch: () => undefined, flush: () => undefined, is_ready: () => true });
family('drw_texturegroup', 'texturegroup_', { get_textures: () => [], load: () => 0, unload: () => undefined, get_status: () => 3 });
// Vertex formats/buffers are created by Deltarune's d3d compatibility init but never submitted.
let vertexIds = 0;
family('drw_vertex', 'vertex_', {
  format_begin: () => undefined, format_add_position: () => undefined, format_add_position_3d: () => undefined, format_add_colour: () => undefined,
  format_add_color: () => undefined, format_add_normal: () => undefined, format_add_textcoord: () => undefined, format_end: () => ++vertexIds,
  create_buffer: () => ++vertexIds,
});

// ---------------------------------------------------------------- surfaces

define('drw_surface_create', (g, s, t) => g.createSurface(Math.max(1, Math.trunc(n(s, t, 0))), Math.max(1, Math.trunc(n(s, t, 1)))));
define('drw_surface_free', (g, s, t) => { g.freeSurface(n(s, t, 0)); return undefined; });
define('drw_surface_exists', (g, s, t) => typeof s[t] === 'number' && g.surfaces.has(s[t] as number));
define('drw_surface_target', (g, s, t) => { g.pushTarget(n(s, t, 0)); return true; });
define('drw_surface_reset', (g) => { g.popTarget(); return true; });
define('drw_surface_size', (g, s, t) => { const sf = g.surface(s[t - 1]); return s[t] === 'width' ? sf.w : sf.h; });
define('drw_surface', (g, s, t) => { const sf = g.surface(s[t]); g.p.renderer.drawImage(sf.tex, 0, 0, sf.w, sf.h, n(s, t, 1), n(s, t, 2), 0, 0, 1, 1, 0, 0xffffff, g.alpha); return undefined; });
define('drw_surface_ext', (g, s, t) => {
  const sf = g.surface(s[t]);
  g.p.renderer.drawImage(sf.tex, 0, 0, sf.w, sf.h, n(s, t, 1), n(s, t, 2), 0, 0, n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7));
  return undefined;
});
define('drw_surface_part', (g, s, t) => {
  const sf = g.surface(s[t]);
  g.p.renderer.drawImage(sf.tex, n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), 0, 0, 1, 1, 0, 0xffffff, g.alpha);
  return undefined;
});
define('drw_app_surface', (g, s, t) => { if (s[t] === 'draw_enable') g.appSurfaceDraw = b(s, t, 1); return undefined; });
define('drw_getpixel', () => 0);
define('drw_surface_getpixel', () => 0);

define('drw_effect', (g, s, t) => {
  g.fx.create(n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), s[t] === 'above');
  return undefined;
});
void str;
