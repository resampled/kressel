// Drawing helpers shared by the draw builtins and the room renderer: sprites, text and primitives,
// expressed in renderer calls. Coordinates are in the current view's world space.

import type { Game } from './game.ts';
import type { FontDef, SpriteDef } from './assets.ts';
import { GmlError } from '../value.ts';

const D2R = Math.PI / 180;

export function frameOf(spr: SpriteDef, index: number): number {
  const n = spr.frames.length;
  return n ? ((Math.floor(index) % n) + n) % n : -1;
}

export function drawSprite(g: Game, spr: SpriteDef, index: number, x: number, y: number, xs: number, ys: number, rot: number, col: number, alpha: number): void {
  const f = frameOf(spr, index);
  if (f < 0) return;
  g.p.renderer.drawImage(spr.frames[f], 0, 0, spr.width, spr.height, x, y, spr.ox, spr.oy, xs, ys, rot, col, alpha);
}

/** draw_sprite_part(_ext): a sub-rectangle of the frame, positioned by its own top-left (no origin). */
export function drawSpritePart(g: Game, spr: SpriteDef, index: number, l: number, t: number, w: number, h: number,
  x: number, y: number, xs: number, ys: number, col: number, alpha: number): void {
  const f = frameOf(spr, index);
  if (f < 0) return;
  // Clip the source rectangle to the image, moving the destination with it.
  if (l < 0) { x -= l * xs; w += l; l = 0; }
  if (t < 0) { y -= t * ys; h += t; t = 0; }
  w = Math.min(w, spr.width - l); h = Math.min(h, spr.height - t);
  if (w <= 0 || h <= 0) return;
  g.p.renderer.drawImage(spr.frames[f], l, t, w, h, x, y, 0, 0, xs, ys, 0, col, alpha);
}

/** draw_sprite_general: part of a frame, scaled, rotated about the part's top-left, with corner colours. */
export function drawSpriteGeneral(g: Game, spr: SpriteDef, index: number, l: number, t: number, w: number, h: number,
  x: number, y: number, xs: number, ys: number, rot: number, c1: number, c2: number, c3: number, c4: number, alpha: number): void {
  const f = frameOf(spr, index);
  if (f < 0) return;
  const c = Math.cos(rot * D2R), s = Math.sin(rot * D2R), W = w * xs, H = h * ys;
  const px = (u: number, v: number) => x + u * c + v * s, py = (u: number, v: number) => y - u * s + v * c;
  g.p.renderer.drawQuad(spr.frames[f], l, t, w, h, px(0, 0), py(0, 0), px(W, 0), py(W, 0), px(W, H), py(W, H), px(0, H), py(0, H), c1, c2, c3, c4, alpha);
}

/** draw_sprite_tiled(_ext): repeats the frame over the whole current view. */
export function drawSpriteTiled(g: Game, spr: SpriteDef, index: number, x: number, y: number, xs: number, ys: number, col: number, alpha: number): void {
  const w = spr.width * xs, h = spr.height * ys;
  if (w <= 0 || h <= 0) return;
  const [vx, vy, vw, vh] = g.viewRect();
  const x0 = x - spr.ox * xs + Math.floor((vx - (x - spr.ox * xs)) / w) * w, y0 = y - spr.oy * ys + Math.floor((vy - (y - spr.oy * ys)) / h) * h;
  for (let ty = y0; ty < vy + vh; ty += h) for (let tx = x0; tx < vx + vw; tx += w) drawSprite(g, spr, index, tx + spr.ox * xs, ty + spr.oy * ys, xs, ys, 0, col, alpha);
}

// ---------------------------------------------------------------- primitives

export function rect(g: Game, x1: number, y1: number, x2: number, y2: number, c1: number, c2: number, c3: number, c4: number, alpha: number, outline: boolean): void {
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  const r = g.p.renderer;
  if (!outline) { quadC(g, x1, y1, x2 + 1, y1, x2 + 1, y2 + 1, x1, y2 + 1, c1, c2, c3, c4, alpha); return; }
  line(g, x1, y1 + 0.5, x2 + 1, y1 + 0.5, 1, c1, c2, alpha);
  line(g, x1, y2 + 0.5, x2 + 1, y2 + 0.5, 1, c4, c3, alpha);
  line(g, x1 + 0.5, y1 + 1, x1 + 0.5, y2, 1, c1, c4, alpha);
  line(g, x2 + 0.5, y1 + 1, x2 + 0.5, y2, 1, c2, c3, alpha);
  void r;
}

/** A coloured quad (corners clockwise from top-left) as two triangles. */
export function quadC(g: Game, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number, c1: number, c2: number, c3: number, c4: number, alpha: number): void {
  const r = g.p.renderer;
  r.triangle(x1, y1, x2, y2, x3, y3, c1, c2, c3, alpha);
  r.triangle(x1, y1, x3, y3, x4, y4, c1, c3, c4, alpha);
}

export function line(g: Game, x1: number, y1: number, x2: number, y2: number, w: number, c1: number, c2: number, alpha: number): void {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  if (len === 0) return;
  const nx = (-dy / len) * w / 2, ny = (dx / len) * w / 2;
  quadC(g, x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny, c1, c2, c2, c1, alpha);
}

export function ellipse(g: Game, cx: number, cy: number, rx: number, ry: number, c1: number, c2: number, alpha: number, outline: boolean, segments = 24): void {
  const r = g.p.renderer;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * rx, y0 = cy + Math.sin(a0) * ry, x1 = cx + Math.cos(a1) * rx, y1 = cy + Math.sin(a1) * ry;
    if (outline) line(g, x0, y0, x1, y1, 1, c2, c2, alpha);
    else r.triangle(cx, cy, x0, y0, x1, y1, c1, c2, c2, alpha);
  }
}

export function triangle(g: Game, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c1: number, c2: number, c3: number, alpha: number, outline: boolean): void {
  if (!outline) { g.p.renderer.triangle(x1, y1, x2, y2, x3, y3, c1, c2, c3, alpha); return; }
  line(g, x1, y1, x2, y2, 1, c1, c2, alpha); line(g, x2, y2, x3, y3, 1, c2, c3, alpha); line(g, x3, y3, x1, y1, 1, c3, c1, alpha);
}

export function roundrect(g: Game, x1: number, y1: number, x2: number, y2: number, rx: number, ry: number, c1: number, c2: number, alpha: number, outline: boolean): void {
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  rx = Math.min(rx, (x2 - x1) / 2); ry = Math.min(ry, (y2 - y1) / 2);
  if (outline || rx <= 0 || ry <= 0) { rect(g, x1, y1, x2, y2, c2, c2, c2, c2, alpha, outline); return; }
  rect(g, x1 + rx, y1, x2 - rx, y2, c2, c2, c2, c2, alpha, false);
  rect(g, x1, y1 + ry, x1 + rx, y2 - ry, c2, c2, c2, c2, alpha, false);
  rect(g, x2 - rx, y1 + ry, x2, y2 - ry, c2, c2, c2, c2, alpha, false);
  for (const [cx, cy] of [[x1 + rx, y1 + ry], [x2 - rx, y1 + ry], [x2 - rx, y2 - ry], [x1 + rx, y2 - ry]]) ellipse(g, cx, cy, rx, ry, c1, c2, alpha, false, 12);
}

// ---------------------------------------------------------------- text

/** Glyph advance of a character (0 if the font lacks it). */
function advance(f: FontDef, c: number): number { return f.glyphs.get(c)?.[4] ?? 0; }

/** Splits text into lines: "\n" (and "\r\n") breaks; with width > 0, words wrap like draw_text_ext. */
export function layoutLines(f: FontDef | undefined, text: string, width: number): string[] {
  const hard = text.split(/\r?\n|\r/);
  if (!f || width <= 0) return hard;
  const out: string[] = [];
  for (const line of hard) {
    let cur = '', curW = 0;
    for (const word of line.split(/(?<= )/)) { // keep spaces attached to the word before them
      let w = 0;
      for (let i = 0; i < word.length; i++) w += advance(f, word.charCodeAt(i));
      if (cur && curW + w - (word.endsWith(' ') ? advance(f, 32) : 0) > width) { out.push(cur.trimEnd()); cur = ''; curW = 0; }
      cur += word; curW += w;
    }
    out.push(cur);
  }
  return out;
}

export function lineWidth(f: FontDef | undefined, s: string): number {
  if (!f) return s.length * 7;
  let w = 0;
  for (let i = 0; i < s.length; i++) w += advance(f, s.charCodeAt(i));
  return w;
}

/** Line height: the font's, or sep when given (draw_text_ext). */
export const lineHeight = (f: FontDef | undefined, sep = -1) => (sep >= 0 ? sep : f ? f.lineHeight : 14);

export function textSize(g: Game, s: string, sep = -1, width = -1): [number, number] {
  const f = g.a.fonts[g.font], lines = layoutLines(f, s, width);
  return [Math.max(0, ...lines.map((l) => lineWidth(f, l))), lines.length * lineHeight(f, sep)];
}

/**
 * draw_text and all its variants: alignment, "\n" line breaks, optional wrapping (width), scale,
 * rotation (about x, y) and a four-corner colour gradient over the whole text block.
 */
export function drawText(g: Game, x: number, y: number, s: string, xs: number, ys: number, angle: number, sep: number, width: number,
  c1: number, c2: number, c3: number, c4: number, alpha: number): void {
  const r = g.p.renderer, f = g.a.fonts[g.font];
  if (!f) { r.systemText(s, x, y, c1, alpha); return; }
  const lines = layoutLines(f, s, width), lh = lineHeight(f, sep);
  const totalH = lines.length * lh, blockW = Math.max(1, ...lines.map((l) => lineWidth(f, l)));
  const cs = Math.cos(angle * D2R), sn = Math.sin(angle * D2R);
  const gradient = c1 !== c2 || c1 !== c3 || c1 !== c4;
  let ly = g.valign === 1 ? -totalH / 2 : g.valign === 2 ? -totalH : 0;
  if (g.valign === 1) ly = Math.floor(ly);
  for (const line of lines) {
    const w = lineWidth(f, line);
    let lx = g.halign === 1 ? -Math.floor(w / 2) : g.halign === 2 ? -w : 0;
    for (let i = 0; i < line.length; i++) {
      const c = line.charCodeAt(i), gl = f.glyphs.get(c);
      if (!gl) continue;
      const ox = (lx + gl[5]) * xs, oy = ly * ys;
      const px = x + ox * cs + oy * sn, py = y - ox * sn + oy * cs;
      if (gradient && f.sprite === undefined) {
        const u0 = (lx + gl[5]) / blockW, u1 = (lx + gl[5] + gl[2]) / blockW, v0 = (ly - (g.valign === 1 ? -totalH / 2 : g.valign === 2 ? -totalH : 0)) / totalH, v1 = v0 + gl[3] / totalH;
        const top = (u: number) => mix(c1, c2, u), bot = (u: number) => mix(c4, c3, u);
        const k1 = mix(top(u0), bot(u0), v0), k2 = mix(top(u1), bot(u1), v0), k3 = mix(top(u1), bot(u1), v1), k4 = mix(top(u0), bot(u0), v1);
        const W = gl[2] * xs, H = gl[3] * ys;
        const qx = (u: number, v: number) => px + u * cs + v * sn, qy = (u: number, v: number) => py - u * sn + v * cs;
        r.drawQuad(f.tex, gl[0], gl[1], gl[2], gl[3], qx(0, 0), qy(0, 0), qx(W, 0), qy(W, 0), qx(W, H), qy(W, H), qx(0, H), qy(0, H), k1, k2, k3, k4, alpha);
      } else if (f.sprite) {
        r.drawImage(f.sprite.frames[gl[0]], 0, 0, gl[2], gl[3], px, py, 0, 0, xs, ys, angle, c1, alpha);
      } else {
        r.drawImage(f.tex, gl[0], gl[1], gl[2], gl[3], px, py, 0, 0, xs, ys, angle, c1, alpha);
      }
      lx += gl[4];
    }
    ly += lh;
  }
}

/** merge_colour in BGR. */
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s;
  return ch(0) | ch(8) | ch(16);
}

export function spriteOrThrow(g: Game, v: number): SpriteDef {
  const s = g.a.sprites[v];
  if (!s) throw new GmlError(`sprite ${v} does not exist`);
  return s;
}
