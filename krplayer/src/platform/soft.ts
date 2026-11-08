// A software renderer (RGBA8 buffers, nearest sampling): what the headless platform draws with when
// a test wants pixels, e.g. a screenshot of frame N. Slow but exact enough to see what the game draws.
// Textures come from the host as decoded RGBA (the platform has no image decoder of its own).

import { WINDOW, type Pixels, type Renderer, type TextureId } from './types.ts';

export type { Pixels };
const D2R = Math.PI / 180;

export class SoftRenderer implements Renderer {
  readonly tex = new Map<TextureId, Pixels>();
  private next = 1;
  private win: Pixels;
  private target: Pixels;
  /** world -> target: x' = a x + c y + e, y' = b x + d y + f */
  private m = [1, 0, 0, 1, 0, 0];
  private src = 5; private dst = 6; private fog = false; private fogCol = 0;
  /** Skip all rasterization (fast runs); draw calls are still counted. */
  enabled = true;
  draws = 0;
  private readonly decode: (url: string) => Promise<Pixels>;

  constructor(decode: (url: string) => Promise<Pixels>, w = 640, h = 480) {
    this.decode = decode;
    this.win = blank(w, h); this.target = this.win;
  }

  async loadTexture(url: string): Promise<TextureId> { const id = this.next++; this.tex.set(id, await this.decode(url)); return id; }
  textureSize(t: TextureId): [number, number] { const p = this.tex.get(t); return p ? [p.w, p.h] : [0, 0]; }
  setWindowSize(w: number, h: number): void { if (w !== this.win.w || h !== this.win.h) { const wasTarget = this.target === this.win; this.win = blank(w, h); if (wasTarget) this.target = this.win; } }
  windowSize(): [number, number] { return [this.win.w, this.win.h]; }
  window(): Pixels { return this.win; }
  beginFrame(): void { this.draws = 0; }
  endFrame(): void {}
  createSurface(w: number, h: number): TextureId { const id = this.next++; this.tex.set(id, blank(w, h)); return id; }
  freeSurface(t: TextureId): void { this.tex.delete(t); }
  readPixels(t: TextureId): Pixels { const p = this.tex.get(t); return p ? { w: p.w, h: p.h, data: new Uint8ClampedArray(p.data) } : { w: 0, h: 0, data: new Uint8ClampedArray(0) }; }
  createTexture(px: Pixels): TextureId { const id = this.next++; this.tex.set(id, { w: px.w, h: px.h, data: new Uint8ClampedArray(px.data) }); return id; }
  copyTexture(t: TextureId, x: number, y: number, w: number, h: number): TextureId {
    const s = this.tex.get(t), id = this.createSurface(w, h), d = this.tex.get(id)!;
    if (s) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const sx = x + i, sy = y + j;
      if (sx >= 0 && sy >= 0 && sx < s.w && sy < s.h) for (let k = 0; k < 4; k++) d.data[(j * w + i) * 4 + k] = s.data[(sy * s.w + sx) * 4 + k];
    }
    return id;
  }
  setTarget(t: TextureId): void {
    this.target = t === WINDOW ? this.win : this.tex.get(t) ?? this.win;
    this.m = [1, 0, 0, 1, 0, 0];
  }
  setView(x: number, y: number, w: number, h: number, angle: number, px: number, py: number, pw: number, ph: number): void {
    const sx = pw / w, sy = ph / h, c = Math.cos(angle * D2R), s = Math.sin(angle * D2R);
    // translate to the view centre, rotate, scale, then to the port centre
    const cx = x + w / 2, cy = y + h / 2, pcx = px + pw / 2, pcy = py + ph / 2;
    this.m = [c * sx, -s * sy, s * sx, c * sy, pcx - (c * cx + s * cy) * sx, pcy - (-s * cx + c * cy) * sy];
  }
  clear(color: number, alpha: number): void {
    if (!this.enabled) return;
    const d = this.target.data, r = color & 255, g = (color >> 8) & 255, b = (color >> 16) & 255, a = Math.round(alpha * 255);
    for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; }
  }
  setBlend(src: number, dst: number): void { this.src = src; this.dst = dst; }
  setFog(on: boolean, color: number): void { this.fog = on; this.fogCol = color; }
  setColorWrite(): void {}
  setFilter(): void {}
  systemText(): void {}

  drawImage(t: TextureId, sx: number, sy: number, sw: number, sh: number, x: number, y: number, ox: number, oy: number,
    xs: number, ys: number, rot: number, color: number, alpha: number): void {
    const c = Math.cos(rot * D2R), s = Math.sin(rot * D2R);
    const pt = (u: number, v: number): [number, number] => { const lx = (u - ox) * xs, ly = (v - oy) * ys; return [x + lx * c + ly * s, y - lx * s + ly * c]; };
    const [x1, y1] = pt(0, 0), [x2, y2] = pt(sw, 0), [x3, y3] = pt(sw, sh), [x4, y4] = pt(0, sh);
    this.drawQuad(t, sx, sy, sw, sh, x1, y1, x2, y2, x3, y3, x4, y4, color, color, color, color, alpha);
  }

  drawQuad(t: TextureId, sx: number, sy: number, sw: number, sh: number, x1: number, y1: number, x2: number, y2: number,
    x3: number, y3: number, x4: number, y4: number, c1: number, _c2: number, _c3: number, _c4: number, alpha: number): void {
    this.draws++;
    const img = this.tex.get(t);
    if (!this.enabled || !img || alpha <= 0) return;
    const [X1, Y1] = this.w(x1, y1), [X2, Y2] = this.w(x2, y2), [X4, Y4] = this.w(x4, y4), [X3, Y3] = this.w(x3, y3);
    // Inverse of the affine map from (u, v) in [0,1]^2 to the parallelogram X1 + u(X2-X1) + v(X4-X1).
    const ax = X2 - X1, ay = Y2 - Y1, bx = X4 - X1, by = Y4 - Y1, det = ax * by - ay * bx;
    if (Math.abs(det) < 1e-9) return;
    const T = this.target, minX = Math.max(0, Math.floor(Math.min(X1, X2, X3, X4))), maxX = Math.min(T.w, Math.ceil(Math.max(X1, X2, X3, X4)));
    const minY = Math.max(0, Math.floor(Math.min(Y1, Y2, Y3, Y4))), maxY = Math.min(T.h, Math.ceil(Math.max(Y1, Y2, Y3, Y4)));
    const tr = (c1 & 255) / 255, tg = ((c1 >> 8) & 255) / 255, tb = ((c1 >> 16) & 255) / 255;
    for (let py = minY; py < maxY; py++) for (let px = minX; px < maxX; px++) {
      const dx = px + 0.5 - X1, dy = py + 0.5 - Y1;
      const u = (dx * by - dy * bx) / det, v = (ax * dy - ay * dx) / det;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const tx = Math.floor(sx + u * sw), ty = Math.floor(sy + v * sh);
      if (tx < 0 || ty < 0 || tx >= img.w || ty >= img.h) continue;
      const k = (ty * img.w + tx) * 4, a = (img.data[k + 3] / 255) * alpha;
      if (a <= 0) continue;
      if (this.fog) this.blend(px, py, (this.fogCol & 255) / 255, ((this.fogCol >> 8) & 255) / 255, ((this.fogCol >> 16) & 255) / 255, a);
      else this.blend(px, py, (img.data[k] / 255) * tr, (img.data[k + 1] / 255) * tg, (img.data[k + 2] / 255) * tb, a);
    }
  }

  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c1: number, c2: number, c3: number, alpha: number): void {
    this.tri(null, x1, y1, 0, 0, c1, x2, y2, 0, 0, c2, x3, y3, 0, 0, c3, alpha);
  }
  triangleTex(t: TextureId, x1: number, y1: number, u1: number, v1: number, c1: number, x2: number, y2: number, u2: number, v2: number, c2: number,
    x3: number, y3: number, u3: number, v3: number, c3: number, alpha: number): void {
    const img = this.tex.get(t);
    if (img) this.tri(img, x1, y1, u1, v1, c1, x2, y2, u2, v2, c2, x3, y3, u3, v3, c3, alpha); else this.draws++;
  }

  // GLSL can't run here: shaders compile to handles and drawing ignores them (said once).
  private shaderWarned = false;
  compileShader(): number { return this.next++; }
  setShader(sh: number): void {
    if (sh >= 0 && !this.shaderWarned) { this.shaderWarned = true; console.warn('soft renderer: shaders are not emulated; drawing without them'); }
  }
  shaderUniform(): number { return this.next++; }
  setUniformF(): void {}
  setSampler(): void {}

  /** Rasterizes a triangle: per-vertex colours, optionally modulating a texture sampled at interpolated u/v. */
  private tri(img: Pixels | null, x1: number, y1: number, u1: number, v1: number, c1: number, x2: number, y2: number, u2: number, v2: number, c2: number,
    x3: number, y3: number, u3: number, v3: number, c3: number, alpha: number): void {
    this.draws++;
    if (!this.enabled || alpha <= 0) return;
    const [X1, Y1] = this.w(x1, y1), [X2, Y2] = this.w(x2, y2), [X3, Y3] = this.w(x3, y3);
    const det = (Y2 - Y3) * (X1 - X3) + (X3 - X2) * (Y1 - Y3);
    if (Math.abs(det) < 1e-9) return;
    const T = this.target, minX = Math.max(0, Math.floor(Math.min(X1, X2, X3))), maxX = Math.min(T.w, Math.ceil(Math.max(X1, X2, X3)));
    const minY = Math.max(0, Math.floor(Math.min(Y1, Y2, Y3))), maxY = Math.min(T.h, Math.ceil(Math.max(Y1, Y2, Y3)));
    const ch = (c: number, s: number) => ((c >> s) & 255) / 255;
    // Top-left fill rule (as GPUs do): a pixel centre exactly on an edge belongs to one triangle only, so the
    // two halves of a translucent rectangle don't blend their shared diagonal twice.
    const sg = Math.sign(det), owns = (ax: number, ay: number, bx: number, by: number) => { const dy = (by - ay) * sg; return dy < 0 || (dy === 0 && (bx - ax) * sg > 0); };
    const t1 = owns(X2, Y2, X3, Y3), t2 = owns(X3, Y3, X1, Y1), t3 = owns(X1, Y1, X2, Y2);
    const inside = (e: number, top: boolean) => e > 0 || (e === 0 && top);
    for (let py = minY; py < maxY; py++) for (let px = minX; px < maxX; px++) {
      const X = px + 0.5, Y = py + 0.5;
      const e1 = ((Y2 - Y3) * (X - X3) + (X3 - X2) * (Y - Y3)) * sg, e2 = ((Y3 - Y1) * (X - X3) + (X1 - X3) * (Y - Y3)) * sg, e3 = Math.abs(det) - e1 - e2;
      if (!inside(e1, t1) || !inside(e2, t2) || !inside(e3, t3)) continue;
      const l1 = e1 / Math.abs(det), l2 = e2 / Math.abs(det), l3 = 1 - l1 - l2;
      let tr = 1, tg = 1, tb = 1, ta = 1;
      if (img) {
        const tx = Math.floor((l1 * u1 + l2 * u2 + l3 * u3) * img.w), ty = Math.floor((l1 * v1 + l2 * v2 + l3 * v3) * img.h);
        if (tx < 0 || ty < 0 || tx >= img.w || ty >= img.h) continue;
        const k = (ty * img.w + tx) * 4;
        tr = img.data[k] / 255; tg = img.data[k + 1] / 255; tb = img.data[k + 2] / 255; ta = img.data[k + 3] / 255;
        if (ta <= 0) continue;
      }
      const f = this.fog;
      this.blend(px, py, f ? ch(this.fogCol, 0) : tr * (l1 * ch(c1, 0) + l2 * ch(c2, 0) + l3 * ch(c3, 0)),
        f ? ch(this.fogCol, 8) : tg * (l1 * ch(c1, 8) + l2 * ch(c2, 8) + l3 * ch(c3, 8)), f ? ch(this.fogCol, 16) : tb * (l1 * ch(c1, 16) + l2 * ch(c2, 16) + l3 * ch(c3, 16)), alpha * ta);
    }
  }

  private w(x: number, y: number): [number, number] { const m = this.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

  /** Blends one pixel with the current factors (GM bm_* numbering). */
  private blend(px: number, py: number, r: number, g: number, b: number, a: number): void {
    const d = this.target.data, k = (py * this.target.w + px) * 4;
    if (this.src === 5 && this.dst === 6) { // bm_normal, the common case
      const ia = 1 - a;
      d[k] = r * 255 * a + d[k] * ia; d[k + 1] = g * 255 * a + d[k + 1] * ia; d[k + 2] = b * 255 * a + d[k + 2] * ia; d[k + 3] = a * 255 * a + d[k + 3] * ia;
      return;
    }
    const dr = d[k] / 255, dg = d[k + 1] / 255, db = d[k + 2] / 255, da = d[k + 3] / 255;
    const f = (m: number, ch: number, dch: number): number => {
      switch (m) {
        case 1: return 0; case 2: return 1; case 3: return ch; case 4: return 1 - ch; case 5: return a; case 6: return 1 - a;
        case 7: return da; case 8: return 1 - da; case 9: return dch; case 10: return 1 - dch; case 11: return Math.min(a, 1 - da);
      }
      return 1;
    };
    d[k] = 255 * Math.min(1, r * f(this.src, r, dr) + dr * f(this.dst, r, dr));
    d[k + 1] = 255 * Math.min(1, g * f(this.src, g, dg) + dg * f(this.dst, g, dg));
    d[k + 2] = 255 * Math.min(1, b * f(this.src, b, db) + db * f(this.dst, b, db));
    d[k + 3] = 255 * Math.min(1, a * f(this.src, a, da) + da * f(this.dst, a, da));
  }
}

function blank(w: number, h: number): Pixels { return { w, h, data: new Uint8ClampedArray(Math.max(1, w * h) * 4) }; }
