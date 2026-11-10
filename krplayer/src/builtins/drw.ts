// Drawing (drw_*).

import { define, family, n, b, str, opt } from './registry.ts';
import { real, NotImplemented, Unverified, type GArray, type Value } from '../value.ts';
import { Instance } from '../runtime/instance.ts';
import { ELEM } from '../runtime/layers.ts';
import type { Game } from '../runtime/game.ts';
import type { SpriteDef } from '../runtime/assets.ts';
import {
  drawSprite, drawSpriteGeneral, drawSpritePart, drawSpriteTiled, drawText, ellipse, line, mix, rect, roundrect, textSize, triangle,
} from '../runtime/draw.ts';
import { gstr } from './opr.ts';

const D2R = Math.PI / 180;

/** draw_sprite* on a missing sprite draws nothing, like GM (error_audit.md). */
const spr = (g: Game, v: unknown): SpriteDef | undefined => g.a.sprites[real(v as number)];
const a = (g: Game) => g.alpha;

define('drw_self', (g) => { if (g.self instanceof Instance) g.drawSelf(g.self); return undefined; });
define('drw_sprite', (g, s, t) => {
  const sp = spr(g, s[t]), f = n(s, t, 1);
  if (!sp) return undefined;
  const img = f < 0 && g.self instanceof Instance ? g.self.image_index : f;
  drawSprite(g, sp, img, n(s, t, 2), n(s, t, 3), 1, 1, 0, 0xffffff, a(g));
  return undefined;
});
define('drw_sprite_ext', (g, s, t) => {
  const sp = spr(g, s[t]), f = n(s, t, 1);
  if (!sp) return undefined;
  const img = f < 0 && g.self instanceof Instance ? g.self.image_index : f;
  drawSprite(g, sp, img, n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7), n(s, t, 8));
  return undefined;
});
define('drw_sprite_stretched', (g, s, t) => {
  const sp = spr(g, s[t]);
  if (!sp) return undefined;
  drawSpriteGeneral(g, sp, n(s, t, 1), 0, 0, sp.width, sp.height, n(s, t, 2), n(s, t, 3), n(s, t, 4) / sp.width, n(s, t, 5) / sp.height, 0, 0xffffff, 0xffffff, 0xffffff, 0xffffff, a(g));
  return undefined;
});
define('drw_sprite_stretched_ext', (g, s, t) => {
  const sp = spr(g, s[t]), c = n(s, t, 6);
  if (!sp) return undefined;
  drawSpriteGeneral(g, sp, n(s, t, 1), 0, 0, sp.width, sp.height, n(s, t, 2), n(s, t, 3), n(s, t, 4) / sp.width, n(s, t, 5) / sp.height, 0, c, c, c, c, n(s, t, 7));
  return undefined;
});
define('drw_sprite_part', (g, s, t) => {
  const sp = spr(g, s[t]);
  if (sp) drawSpritePart(g, sp, n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7), 1, 1, 0xffffff, a(g));
  return undefined;
});
define('drw_sprite_part_ext', (g, s, t) => {
  const sp = spr(g, s[t]);
  if (sp) drawSpritePart(g, sp, n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7), n(s, t, 8), n(s, t, 9), n(s, t, 10), n(s, t, 11));
  return undefined;
});
define('drw_sprite_general', (g, s, t) => {
  const sp = spr(g, s[t]);
  if (sp) drawSpriteGeneral(g, sp, n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7), n(s, t, 8), n(s, t, 9), n(s, t, 10),
    n(s, t, 11), n(s, t, 12), n(s, t, 13), n(s, t, 14), n(s, t, 15));
  return undefined;
});
define('drw_sprite_pos', (g, s, t) => {
  const sp = spr(g, s[t]), f = Math.floor(n(s, t, 1));
  if (!sp) return undefined;
  g.p.renderer.drawQuad(sp.frames[((f % sp.frames.length) + sp.frames.length) % sp.frames.length], 0, 0, sp.width, sp.height,
    n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7), n(s, t, 8), n(s, t, 9), 0xffffff, 0xffffff, 0xffffff, 0xffffff, n(s, t, 10));
  return undefined;
});
define('drw_sprite_tiled', (g, s, t) => { const sp = spr(g, s[t]); if (sp) drawSpriteTiled(g, sp, n(s, t, 1), n(s, t, 2), n(s, t, 3), 1, 1, 0xffffff, a(g)); return undefined; });
define('drw_sprite_tiled_ext', (g, s, t) => {
  const sp = spr(g, s[t]);
  if (sp) drawSpriteTiled(g, sp, n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), n(s, t, 6), n(s, t, 7));
  return undefined;
});
/** draw_path: the followed line in the draw colour; relative paths put their first point at (x, y). */
define('drw_path', (g, s, t) => {
  const p = g.paths.get(n(s, t, 0), 'draw_path'), pts = p.polyline();
  const dx = b(s, t, 3) ? 0 : n(s, t, 1) - (pts[0] ?? 0), dy = b(s, t, 3) ? 0 : n(s, t, 2) - (pts[1] ?? 0);
  for (let k = 2; k + 1 < pts.length; k += 2) line(g, pts[k - 2] + dx, pts[k - 1] + dy, pts[k] + dx, pts[k + 1] + dy, 1, g.colour, g.colour, g.alpha);
  return undefined;
});

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
  // GM stores any id unchecked (HTML5 draw_set_font); text in a missing font draws in the fallback font.
  g.font = Math.trunc(real(s[t])); return undefined;
});
define('drw_set_colour', (g, s, t) => { g.colour = n(s, t, 0); return undefined; });
define('drw_set_alpha', (g, s, t) => { g.alpha = n(s, t, 0); return undefined; });
define('drw_set_align', (g, s, t) => { if (s[t] === 'h') g.halign = n(s, t, 1); else g.valign = n(s, t, 1); return undefined; });
define('drw_get', (g, s, t) => {
  switch (s[t]) {
    case 'colour': return g.colour; case 'alpha': return g.alpha; case 'font': return g.font;
    case 'halign': return g.halign; case 'valign': return g.valign;
  }
  throw new NotImplemented(`draw_get_${String(s[t])} unknown`);
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
/** GM rounds the precision to a multiple of 4 in 4..64. */
define('drw_circle_precision', (g, s, t) => { g.circlePrecision = Math.max(4, Math.min(64, Math.round(n(s, t, 0) / 4) * 4)); return undefined; });
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
  throw new NotImplemented(`colour_get_${String(s[t])} unknown`);
});

// ---------------------------------------------------------------- GPU state

/** bm_normal 0, bm_add 1, bm_max 2, bm_subtract 3 -> factor pairs (GM bm_* factor constants). */
const BLEND: Record<number, [number, number]> = { 0: [5, 6], 1: [5, 2], 2: [5, 4], 3: [1, 4] };
define('drw_blendmode', (g, s, t) => {
  const m = BLEND[n(s, t, 0)];
  if (!m) throw new NotImplemented(`blend mode ${n(s, t, 0)} not supported`);
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
  alphatestenable: (g, s, t) => { g.alphaTest = b(s, t, 0); g.p.renderer.setAlphaTest(g.alphaTest, g.alphaRef); return undefined; },
  alphatestref: (g, s, t) => { g.alphaRef = Math.max(0, Math.min(255, n(s, t, 0))); g.p.renderer.setAlphaTest(g.alphaTest, g.alphaRef); return undefined; },
  ztestenable: () => undefined, zwriteenable: () => undefined, cullmode: () => undefined,
});
// Texture pages are a desktop concern: everything is resident in krplayer.
family('drw_texture', 'texture_', {
  prefetch: () => undefined, flush: () => undefined, is_ready: () => true,
  get_texel_width: (g, s, t) => { const w = g.p.renderer.textureSize(n(s, t, 0))[0]; return w ? 1 / w : 0; },
  get_texel_height: (g, s, t) => { const h = g.p.renderer.textureSize(n(s, t, 0))[1]; return h ? 1 / h : 0; },
  get_width: () => 1, get_height: () => 1, // krplayer textures are whole frames, so the frame fills its texture
  set_stage: (g, s, t) => { g.p.renderer.setSampler(n(s, t, 0), n(s, t, 1)); return undefined; },
});
family('drw_texturegroup', 'texturegroup_', { get_textures: () => [], load: () => 0, unload: () => undefined, get_status: () => 3 });
// Vertex buffers. krplayer draws in 2D, so a buffer keeps what a primitive needs (x, y, u, v, colour, alpha per
// vertex) and drops z, normals and custom attributes. A format is its attribute count: every vertex_* write is
// one attribute, and a vertex is complete after that many.
interface VBuf { per: number; k: number; n: number; d: Float64Array; open: boolean }
const vformats: number[] = [0], vbufs: (VBuf | null)[] = [null];
let vformat = 0;
const fmtAdd = () => { vformat++; return undefined; };
const vbuf = (v: Value, fn: string): VBuf => {
  const bf = vbufs[real(v)];
  if (!bf) throw new Unverified(`${fn}: vertex buffer ${String(v)} does not exist`);
  return bf;
};
/** Starts the next attribute of buffer s[t] and returns the offset of its vertex in d. */
function vattr(s: Value[], t: number, fn: string): number {
  const bf = vbuf(s[t], fn);
  if (!bf.open) throw new Unverified(`${fn} outside vertex_begin/vertex_end`);
  if (bf.k === 0) {
    if ((bf.n + 1) * 6 > bf.d.length) { const d = new Float64Array(bf.d.length * 2); d.set(bf.d); bf.d = d; }
    bf.d.set([0, 0, 0, 0, 0xffffff, 1], bf.n++ * 6);
  }
  bf.k = (bf.k + 1) % bf.per;
  return (bf.n - 1) * 6;
}
const vskip = (fn: string) => (_g: Game, s: Value[], t: number) => { vattr(s, t, fn); return undefined; };
const vpos = (g: Game, s: Value[], t: number) => { const o = vattr(s, t, 'vertex_position'), d = vbuf(s[t], '').d; d[o] = n(s, t, 1); d[o + 1] = n(s, t, 2); return undefined; };
const vcol = (g: Game, s: Value[], t: number) => { const o = vattr(s, t, 'vertex_colour'), d = vbuf(s[t], '').d; d[o + 4] = n(s, t, 1); d[o + 5] = n(s, t, 2); return undefined; };
const vtex = (g: Game, s: Value[], t: number) => { const o = vattr(s, t, 'vertex_texcoord'), d = vbuf(s[t], '').d; d[o + 2] = n(s, t, 1); d[o + 3] = n(s, t, 2); return undefined; };
family('drw_vertex', 'vertex_', {
  format_begin: () => { vformat = 0; return undefined; },
  format_add_position: fmtAdd, format_add_position_3d: fmtAdd, format_add_colour: fmtAdd, format_add_color: fmtAdd, format_add_normal: fmtAdd,
  format_add_texcoord: fmtAdd, format_add_textcoord: fmtAdd, format_add_custom: fmtAdd,
  format_end: () => vformats.push(vformat) - 1,
  format_delete: () => undefined,
  create_buffer: () => vbufs.push({ per: 1, k: 0, n: 0, d: new Float64Array(6 * 64), open: false }) - 1,
  create_buffer_ext: () => vbufs.push({ per: 1, k: 0, n: 0, d: new Float64Array(6 * 64), open: false }) - 1,
  delete_buffer: (_g, s, t) => { vbuf(s[t], 'vertex_delete_buffer'); vbufs[real(s[t])] = null; return undefined; },
  begin: (_g, s, t) => {
    const bf = vbuf(s[t], 'vertex_begin'), per = vformats[real(s[t - 1])];
    if (!per) throw new Unverified(`vertex_begin: vertex format ${String(s[t - 1])} does not exist`);
    bf.per = per; bf.k = 0; bf.n = 0; bf.open = true;
    return undefined;
  },
  end: (_g, s, t) => { vbuf(s[t], 'vertex_end').open = false; return undefined; },
  freeze: (_g, s, t) => { vbuf(s[t], 'vertex_freeze'); return 0; },
  get_number: (_g, s, t) => vbuf(s[t], 'vertex_get_number').n,
  position: vpos, position_3d: vpos, colour: vcol, color: vcol, texcoord: vtex,
  argb: (_g, s, t) => {
    const o = vattr(s, t, 'vertex_argb'), d = vbuf(s[t], '').d, c = n(s, t, 1) >>> 0;
    d[o + 4] = ((c >> 16) & 255) | (c & 0xff00) | ((c & 255) << 16); d[o + 5] = (c >>> 24) / 255;
    return undefined;
  },
  normal: vskip('vertex_normal'), float1: vskip('vertex_float1'), float2: vskip('vertex_float2'), float3: vskip('vertex_float3'),
  float4: vskip('vertex_float4'), ubyte4: vskip('vertex_ubyte4'),
  /** vertex_submit(buffer, primitive kind, texture): -1 draws untextured. */
  submit: (g, s, t) => { const bf = vbuf(s[t], 'vertex_submit'); drawPrim(g, n(s, t, 1), n(s, t, 2), bf.d, bf.n); return undefined; },
});

// Matrices are 16-element arrays (row-vector convention, translation in 12..14). krplayer draws in 2D only,
// so matrix_set accepts the identity and fails loudly otherwise instead of drawing untransformed.
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const matMul = (a: number[], b: number[]): GArray => Array.from({ length: 16 }, (_, k) => {
  const r = k >> 2, c = k & 3;
  return a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
});
const matrix = (v: Value, fn: string): number[] => {
  if (!Array.isArray(v) || v.length < 16) throw new Unverified(`${fn}: not a matrix`);
  return v.slice(0, 16).map((x) => real(x));
};
family('drw_matrix', 'matrix_', {
  build_identity: () => [...IDENTITY],
  /** Scale, then rotate about x, y, z (degrees), then translate. */
  build: (_g, s, t) => {
    const [x, y, z, ax, ay, az, sx, sy, sz] = Array.from({ length: 9 }, (_, k) => n(s, t, k));
    const c = (d: number) => Math.cos(d * D2R), si = (d: number) => Math.sin(d * D2R);
    const rx = [1, 0, 0, 0, 0, c(ax), si(ax), 0, 0, -si(ax), c(ax), 0, 0, 0, 0, 1];
    const ry = [c(ay), 0, -si(ay), 0, 0, 1, 0, 0, si(ay), 0, c(ay), 0, 0, 0, 0, 1];
    const rz = [c(az), si(az), 0, 0, -si(az), c(az), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const m = matMul(matMul(matMul([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1], rx) as number[], ry) as number[], rz);
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  },
  multiply: (_g, s, t) => matMul(matrix(s[t], 'matrix_multiply'), matrix(s[t - 1], 'matrix_multiply')),
  get: (g, s, t) => [...(g.matrices[n(s, t, 0)] ?? IDENTITY)] as GArray,
  set: (g, s, t) => {
    const which = n(s, t, 0), m = matrix(s[t - 1], 'matrix_set');
    if (!g.matrices[which]) throw new Unverified(`matrix_set: unknown matrix type ${which}`);
    if (m.some((x, k) => x !== IDENTITY[k])) throw new NotImplemented('matrix_set: krplayer draws in 2D and does not support transform matrices yet');
    g.matrices[which] = m;
    return undefined;
  },
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
/** A surface pixel as BGR, or ABGR with alpha in the top byte (_ext). Reads the whole surface back, so it's slow. */
const getpixel = (g: Game, s: Value[], t: number, ext: boolean) => {
  const sf = g.surface(s[t]), x = Math.trunc(n(s, t, 1)), y = Math.trunc(n(s, t, 2));
  if (x < 0 || y < 0 || x >= sf.w || y >= sf.h) return 0;
  const px = g.p.renderer.readPixels(sf.tex), k = (y * px.w + x) * 4, d = px.data;
  const bgr = d[k] | (d[k + 1] << 8) | (d[k + 2] << 16);
  return ext ? (bgr | (d[k + 3] << 24)) >>> 0 : bgr;
};
define('drw_surface_getpixel', (g, s, t) => getpixel(g, s, t, false));
define('drw_surface_getpixel_ext', (g, s, t) => getpixel(g, s, t, true));
define('drw_surface_texture', (g, s, t) => g.surface(s[t]).tex);

// ---------------------------------------------------------------- primitives

// Vertices since draw_primitive_begin: x, y, u, v, colour, alpha. Grown on demand, never shrunk.
let prim = new Float64Array(6 * 1024), primN = 0, primKind = -1, primTex = -1;
const begin = (kind: number, tex: number) => { primKind = kind; primTex = tex; primN = 0; return undefined; };
function vertex(x: number, y: number, u: number, v: number, c: number, al: number) {
  if (primKind < 0) throw new Unverified('draw_vertex outside draw_primitive_begin/end');
  if ((primN + 1) * 6 > prim.length) { const p = new Float64Array(prim.length * 2); p.set(prim); prim = p; }
  const o = primN++ * 6;
  prim[o] = x; prim[o + 1] = y; prim[o + 2] = u; prim[o + 3] = v; prim[o + 4] = c; prim[o + 5] = al;
  return undefined;
}
define('drw_primitive_begin', (_g, s, t) => begin(n(s, t, 0), -1));
define('drw_primitive_begin_texture', (_g, s, t) => begin(n(s, t, 0), n(s, t, 1)));
define('drw_prim_vertex', (g, s, t) => vertex(n(s, t, 0), n(s, t, 1), 0, 0, g.colour, g.alpha));
define('drw_prim_vertex_colour', (_g, s, t) => vertex(n(s, t, 0), n(s, t, 1), 0, 0, n(s, t, 2), n(s, t, 3)));
define('drw_prim_vertex_texture', (g, s, t) => vertex(n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), g.colour, g.alpha));
define('drw_prim_vertex_texture_colour', (_g, s, t) => vertex(n(s, t, 0), n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5)));
define('drw_primitive_end', (g) => { const kind = primKind; primKind = -1; drawPrim(g, kind, primTex, prim, primN); return undefined; });
/** Draws primN vertices of P: pr_pointlist 1, linelist 2, linestrip 3, trianglelist 4, trianglestrip 5, trianglefan 6. Alpha is per primitive (the first vertex's). */
function drawPrim(g: Game, kind: number, primTex: number, P: Float64Array, primN: number): void {
  const r = g.p.renderer, tri = (i: number, j: number, k: number) => {
    const a = i * 6, b2 = j * 6, c = k * 6;
    if (primTex >= 0) r.triangleTex(primTex, P[a], P[a + 1], P[a + 2], P[a + 3], P[a + 4], P[b2], P[b2 + 1], P[b2 + 2], P[b2 + 3], P[b2 + 4], P[c], P[c + 1], P[c + 2], P[c + 3], P[c + 4], P[a + 5]);
    else r.triangle(P[a], P[a + 1], P[b2], P[b2 + 1], P[c], P[c + 1], P[a + 4], P[b2 + 4], P[c + 4], P[a + 5]);
  };
  const seg = (i: number, j: number) => line(g, P[i * 6], P[i * 6 + 1], P[j * 6], P[j * 6 + 1], 1, P[i * 6 + 4], P[j * 6 + 4], P[i * 6 + 5]);
  switch (kind) {
    case 1: for (let i = 0; i < primN; i++) rect(g, P[i * 6], P[i * 6 + 1], P[i * 6], P[i * 6 + 1], P[i * 6 + 4], P[i * 6 + 4], P[i * 6 + 4], P[i * 6 + 4], P[i * 6 + 5], false); break;
    case 2: for (let i = 1; i < primN; i += 2) seg(i - 1, i); break;
    case 3: for (let i = 1; i < primN; i++) seg(i - 1, i); break;
    case 4: for (let i = 2; i < primN; i += 3) tri(i - 2, i - 1, i); break;
    case 5: for (let i = 2; i < primN; i++) tri(i - 2, i - 1, i); break;
    case 6: for (let i = 2; i < primN; i++) tri(0, i - 1, i); break;
    default: throw new Unverified(`draw_primitive_begin: unknown primitive kind ${kind}`);
  }
}

// ---------------------------------------------------------------- shaders

const shader = (g: Game, v: Value, fn: string) => {
  const sh = g.a.shaders[real(v)];
  if (!sh) throw new Unverified(`${fn}: shader ${String(v)} does not exist`);
  if (sh.handle < 0) throw new NotImplemented(`${fn}: shader ${sh.name} did not compile`);
  return sh.handle;
};
define('drw_shader_set', (g, s, t) => { g.p.renderer.setShader(shader(g, s[t], 'shader_set')); return undefined; });
define('drw_shader_reset', (g) => { g.p.renderer.setShader(-1); return undefined; });
define('drw_shader_uniform', (g, s, t) => g.p.renderer.shaderUniform(shader(g, s[t], 'shader_get_uniform'), str(s, t, 1)));
define('drw_shader_sampler', (g, s, t) => g.p.renderer.shaderUniform(shader(g, s[t], 'shader_get_sampler_index'), str(s, t, 1)));
define('drw_shader_uniform_f', (g, s, t, argc) => {
  const k = argc - 1, v = (i: number) => (i < k ? n(s, t, i + 1) : 0);
  g.p.renderer.setUniformF(n(s, t, 0), k, v(0), v(1), v(2), v(3));
  return undefined;
});
define('drw_tilemap', (g, s, t) => {
  const e = g.layers.element(n(s, t, 0));
  if (e && e.kind === ELEM.tilemap) g.drawTilemap(e, n(s, t, 1), n(s, t, 2)); // missing tilemap: draws nothing (gm_gotchas.md)
  return undefined;
});

define('drw_effect', (g, s, t) => {
  g.fx.create(n(s, t, 1), n(s, t, 2), n(s, t, 3), n(s, t, 4), n(s, t, 5), s[t] === 'above');
  return undefined;
});
void str;
