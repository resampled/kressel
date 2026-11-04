// Browser platform: Canvas 2D rendering, keyboard input, localStorage. (WebGL/WebAudio todo.)

import type { Platform, Renderer, TextureId } from './types.ts';

const D2R = Math.PI / 180;
const cssCache = new Map<number, string>();
/** BGR -> CSS colour string, cached (alpha goes through globalAlpha). */
function css(bgr: number): string {
  let s = cssCache.get(bgr);
  if (!s) { s = `rgb(${bgr & 255},${(bgr >> 8) & 255},${(bgr >> 16) & 255})`; cssCache.set(bgr, s); }
  return s;
}

class CanvasRenderer implements Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: (ImageBitmap | null)[] = [null];
  private readonly loading = new Map<number, Promise<ImageBitmap>>();
  /** Tinted copies, keyed by texture id * 2^24 + BGR colour. */
  private readonly tinted = new Map<number, OffscreenCanvas>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
  }

  loadTexture(url: string): Promise<TextureId> {
    const id = this.tex.length;
    this.tex.push(null);
    const p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`failed to load texture ${url} (${r.status})`);
      return r.blob();
    }).then((b) => createImageBitmap(b));
    this.loading.set(id, p);
    return p.then((bmp) => { this.tex[id] = bmp; return id; });
  }

  async textureSize(tex: TextureId): Promise<[number, number]> {
    const bmp = this.tex[tex] ?? await this.loading.get(tex);
    if (!bmp) throw new Error(`texture ${tex} not loaded`);
    return [bmp.width, bmp.height];
  }

  beginFrame(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.ctx.imageSmoothingEnabled = false; // GM's default: no texture interpolation
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  endFrame(): void {}

  clear(color: number, alpha: number): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.globalAlpha = alpha;
    c.fillStyle = css(color);
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private source(tex: TextureId, color: number): CanvasImageSource | null {
    const bmp = this.tex[tex];
    if (!bmp || (color & 0xffffff) === 0xffffff) return bmp ?? null;
    const key = tex * 0x1000000 + (color & 0xffffff);
    let t = this.tinted.get(key);
    if (!t) { // multiply by the colour, keeping the original alpha
      t = new OffscreenCanvas(bmp.width, bmp.height);
      const c = t.getContext('2d')!;
      c.drawImage(bmp, 0, 0);
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = css(color);
      c.fillRect(0, 0, bmp.width, bmp.height);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(bmp, 0, 0);
      this.tinted.set(key, t);
    }
    return t;
  }

  drawImage(tex: TextureId, sx: number, sy: number, sw: number, sh: number, x: number, y: number, ox: number, oy: number,
    xscale: number, yscale: number, rot: number, color: number, alpha: number): void {
    const img = this.source(tex, color);
    if (!img || alpha <= 0) return;
    const c = this.ctx, cs = Math.cos(rot * D2R), sn = Math.sin(rot * D2R);
    c.setTransform(cs * xscale, -sn * xscale, sn * yscale, cs * yscale, x, y);
    c.globalAlpha = alpha;
    c.drawImage(img, sx, sy, sw, sh, -ox, -oy, sw, sh);
  }

  rect(x1: number, y1: number, x2: number, y2: number, color: number, alpha: number, outline: boolean): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = alpha;
    if (outline) { c.strokeStyle = css(color); c.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1, y2 - y1); }
    else { c.fillStyle = css(color); c.fillRect(x1, y1, x2 - x1, y2 - y1); }
  }

  circle(x: number, y: number, r: number, color: number, alpha: number, outline: boolean): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = alpha;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    if (outline) { c.strokeStyle = css(color); c.stroke(); } else { c.fillStyle = css(color); c.fill(); }
  }

  systemText(text: string, x: number, y: number, color: number, alpha: number): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = alpha;
    c.font = '12px Arial, sans-serif';
    c.textBaseline = 'top';
    c.fillStyle = css(color);
    text.split('\n').forEach((line, i) => c.fillText(line, x, y + i * 14));
  }
}

/** Keys whose browser default (scrolling, focus moves) would get in the way of a game. */
const SWALLOW = new Set([8, 9, 13, 32, 33, 34, 35, 36, 37, 38, 39, 40]);

export function createWebPlatform(canvas: HTMLCanvasElement): Platform {
  const input = { keys: new Uint8Array(256), pressed: new Uint8Array(256), released: new Uint8Array(256), mouseX: 0, mouseY: 0, mouseButtons: 0 };
  // GM key codes are Windows virtual-key codes, which KeyboardEvent.keyCode still reports.
  addEventListener('keydown', (e) => {
    const k = e.keyCode & 255;
    if (!input.keys[k]) input.pressed[k] = 1;
    input.keys[k] = 1;
    if (SWALLOW.has(k)) e.preventDefault();
  });
  addEventListener('keyup', (e) => {
    const k = e.keyCode & 255;
    if (input.keys[k]) input.released[k] = 1;
    input.keys[k] = 0;
  });
  addEventListener('blur', () => input.keys.fill(0));
  const unsupported = () => { throw new Error('audio is not implemented in krplayer yet'); };
  return {
    renderer: new CanvasRenderer(canvas),
    audio: { load: async () => unsupported(), play: unsupported, stop: unsupported },
    input,
    storage: {
      read: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
      write: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
    },
    now: () => performance.now(),
  };
}
