// Browser platform: a batched WebGL2 renderer, WebAudio, keyboard input and IndexedDB saves.

import { WINDOW, type Audio, type FontRasterizer, type Pixels, type Platform, type Renderer, type TextureId, type VoiceId } from './types.ts';
import { FileStore, idbBackend } from './filestore.ts';
import { glslTo300 } from './glsl.ts';

const D2R = Math.PI / 180;
const MAX_QUADS = 8192, FLOATS = 5; // x y u v colour(rgba8 as one float slot)

const VS = `#version 300 es
in vec2 a_pos; in vec2 a_uv; in vec4 a_col;
uniform vec4 u_proj; // pixel -> clip: x * sx + tx, y * sy + ty
out vec2 v_uv; out vec4 v_col;
void main() { gl_Position = vec4(a_pos.x * u_proj.x + u_proj.z, a_pos.y * u_proj.y + u_proj.w, 0.0, 1.0); v_uv = a_uv; v_col = a_col; }`;
const FS = `#version 300 es
precision mediump float;
in vec2 v_uv; in vec4 v_col;
uniform sampler2D u_tex; uniform vec4 u_fog;
out vec4 o;
void main() { vec4 c = texture(u_tex, v_uv) * v_col; if (u_fog.a > 0.5) c.rgb = u_fog.rgb; o = c; }`;

interface Tex { t: WebGLTexture; w: number; h: number; fb: WebGLFramebuffer | null }

/** GM bm_* factor constants -> GL. */
const factor = (gl: WebGL2RenderingContext, f: number): number =>
  [gl.ONE, gl.ZERO, gl.ONE, gl.SRC_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.DST_ALPHA, gl.ONE_MINUS_DST_ALPHA, gl.DST_COLOR, gl.ONE_MINUS_DST_COLOR, gl.SRC_ALPHA_SATURATE][f] ?? gl.ONE;

class GLRenderer implements Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly tex: (Tex | null)[] = [null];
  private readonly white: TextureId;
  private readonly prog: WebGLProgram;
  private readonly uProj: WebGLUniformLocation;
  private readonly uFog: WebGLUniformLocation;
  private readonly buf = new ArrayBuffer(MAX_QUADS * 6 * FLOATS * 4);
  private readonly f32 = new Float32Array(this.buf);
  private readonly u32 = new Uint32Array(this.buf);
  private n = 0; // vertices in the batch
  private cur: TextureId = -2;
  private target: TextureId = WINDOW;
  private tw = 0; private th = 0;
  /** world -> target pixels */
  private m = [1, 0, 0, 1, 0, 0];
  private filter = false;
  /** GameMaker shaders (compileShader handles index this), the one in use (-1: default), and uniform handles. */
  private readonly shaders: { p: WebGLProgram; wvp: WebGLUniformLocation | null; units: number }[] = [];
  private shader = -1;
  private readonly uniforms: { sh: number; loc: WebGLUniformLocation; unit: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(p, 0, 'a_pos'); gl.bindAttribLocation(p, 1, 'a_uv'); gl.bindAttribLocation(p, 2, 'a_col');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
    this.prog = p;
    gl.useProgram(p);
    this.uProj = gl.getUniformLocation(p, 'u_proj')!;
    this.uFog = gl.getUniformLocation(p, 'u_fog')!;
    gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0);
    gl.uniform4f(this.uFog, 0, 0, 0, 0);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, this.buf.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, FLOATS * 4, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, FLOATS * 4, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, FLOATS * 4, 16);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.white = this.upload(new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1));
    this.setTarget(WINDOW);
  }

  private upload(src: TexImageSource, w = (src as ImageBitmap).width, h = (src as ImageBitmap).height): TextureId {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    this.params();
    this.cur = -2;
    this.tex.push({ t, w, h, fb: null });
    return this.tex.length - 1;
  }
  private params(): void {
    const gl = this.gl, f = this.filter ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  async loadTexture(url: string): Promise<TextureId> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`failed to load texture ${url} (${r.status})`);
    return this.upload(await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
  }
  textureSize(t: TextureId): [number, number] { const x = this.tex[t]; return x ? [x.w, x.h] : [0, 0]; }
  setWindowSize(w: number, h: number): void {
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.flush();
    this.canvas.width = w; this.canvas.height = h;
    if (this.target === WINDOW) this.setTarget(WINDOW);
  }
  windowSize(): [number, number] { return [this.canvas.width, this.canvas.height]; }
  beginFrame(): void {}
  endFrame(): void { this.flush(); }

  createSurface(w: number, h: number): TextureId {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.params();
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    this.cur = -2;
    this.tex.push({ t, w, h, fb });
    const id = this.tex.length - 1;
    this.bindTarget();
    return id;
  }
  freeSurface(id: TextureId): void {
    const x = this.tex[id];
    if (!x) return;
    this.flush();
    this.gl.deleteTexture(x.t);
    if (x.fb) this.gl.deleteFramebuffer(x.fb);
    this.tex[id] = null;
  }
  readPixels(id: TextureId): Pixels {
    const x = this.tex[id];
    if (!x?.fb) return { w: 0, h: 0, data: new Uint8ClampedArray(0) };
    this.flush();
    const gl = this.gl, data = new Uint8ClampedArray(x.w * x.h * 4);
    // Surfaces are drawn upside down, so GL's bottom row is the surface's top row.
    gl.bindFramebuffer(gl.FRAMEBUFFER, x.fb);
    gl.readPixels(0, 0, x.w, x.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    this.bindTarget();
    return { w: x.w, h: x.h, data };
  }
  createTexture(px: Pixels): TextureId {
    this.flush();
    return this.upload(new ImageData(px.data as Uint8ClampedArray<ArrayBuffer>, px.w, px.h));
  }
  copyTexture(id: TextureId, x: number, y: number, w: number, h: number): TextureId {
    const src = this.tex[id];
    const out = this.createSurface(w, h);
    if (!src) return out;
    const prev = this.target;
    this.setTarget(out);
    this.drawImage(id, x, y, w, h, 0, 0, 0, 0, 1, 1, 0, 0xffffff, 1);
    this.setTarget(prev);
    return out;
  }

  private bindTarget(): void {
    const gl = this.gl, t = this.target === WINDOW ? null : this.tex[this.target];
    gl.bindFramebuffer(gl.FRAMEBUFFER, t?.fb ?? null);
    this.tw = t ? t.w : this.canvas.width; this.th = t ? t.h : this.canvas.height;
    gl.viewport(0, 0, this.tw, this.th);
  }
  setTarget(t: TextureId): void {
    this.flush();
    this.target = this.tex[t]?.fb ? t : WINDOW;
    this.bindTarget();
    this.gl.disable(this.gl.SCISSOR_TEST);
    this.m = [1, 0, 0, 1, 0, 0];
    this.project();
  }
  /** Uploads pixel -> clip; surfaces are drawn upside down so their textures read back upright. */
  private project(): void {
    const ys = this.target === WINDOW ? -2 / this.th : 2 / this.th, ty = this.target === WINDOW ? 1 : -1, sh = this.shaders[this.shader];
    if (!sh) { this.gl.uniform4f(this.uProj, 2 / this.tw, ys, -1, ty); return; }
    // GM shaders: gm_Matrices[MATRIX_WORLD_VIEW_PROJECTION] maps the (already world -> pixel) vertices to clip space.
    if (sh.wvp) this.gl.uniformMatrix4fv(sh.wvp, false, [2 / this.tw, 0, 0, 0, 0, ys, 0, 0, 0, 0, 1, 0, -1, ty, 0, 1]);
  }

  compileShader(vertex: string, fragment: string): number {
    // GM's GLSL ES 1.00 runs as 3.00 (see glsl.ts); the untranslated source is the fallback, and both logs are kept.
    const gl = this.gl, mk = (type: number, src: string) => {
      let log = '';
      for (const s of [glslTo300(src, type === gl.FRAGMENT_SHADER), src]) {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, s); gl.compileShader(sh);
        if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return sh;
        log += gl.getShaderInfoLog(sh) ?? ''; gl.deleteShader(sh);
      }
      console.warn(`shader compile: ${log}`);
      return null;
    };
    const vs = mk(gl.VERTEX_SHADER, vertex), fs = mk(gl.FRAGMENT_SHADER, fragment);
    if (!vs || !fs) return -1;
    const p = gl.createProgram()!;
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'in_Position'); gl.bindAttribLocation(p, 1, 'in_TextureCoord'); gl.bindAttribLocation(p, 2, 'in_Colour');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn(`shader link: ${gl.getProgramInfoLog(p)}`); return -1; }
    gl.useProgram(p);
    const base = gl.getUniformLocation(p, 'gm_BaseTexture');
    if (base) gl.uniform1i(base, 0);
    for (let k = 0; k < 5; k++) { const m = gl.getUniformLocation(p, `gm_Matrices[${k}]`); if (m) gl.uniformMatrix4fv(m, false, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
    gl.useProgram(this.shaders[this.shader]?.p ?? this.prog);
    this.shaders.push({ p, wvp: gl.getUniformLocation(p, 'gm_Matrices[4]'), units: 1 });
    return this.shaders.length - 1;
  }
  setShader(sh: number): void {
    if (sh === this.shader || (sh >= 0 && !this.shaders[sh])) return;
    this.flush();
    this.shader = this.shaders[sh] ? sh : -1;
    this.gl.useProgram(this.shaders[this.shader]?.p ?? this.prog);
    this.project();
  }
  shaderUniform(sh: number, name: string): number {
    const s = this.shaders[sh], loc = s && this.gl.getUniformLocation(s.p, name);
    if (!loc) return -1;
    this.uniforms.push({ sh, loc, unit: -1 });
    return this.uniforms.length - 1;
  }
  setUniformF(u: number, n: number, x: number, y: number, z: number, w: number): void {
    const un = this.uniforms[u];
    if (!un || un.sh !== this.shader) return; // GM: uniforms only apply to the shader that's set
    this.flush();
    const gl = this.gl;
    if (n === 1) gl.uniform1f(un.loc, x); else if (n === 2) gl.uniform2f(un.loc, x, y); else if (n === 3) gl.uniform3f(un.loc, x, y, z); else gl.uniform4f(un.loc, x, y, z, w);
  }
  setSampler(u: number, t: TextureId): void {
    const un = this.uniforms[u], x = this.tex[t];
    if (!un || !x || un.sh !== this.shader) return;
    this.flush();
    const gl = this.gl;
    if (un.unit < 0) un.unit = this.shaders[un.sh].units++;
    gl.activeTexture(gl.TEXTURE0 + un.unit);
    gl.bindTexture(gl.TEXTURE_2D, x.t); this.params();
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(un.loc, un.unit);
  }
  setView(x: number, y: number, w: number, h: number, angle: number, px: number, py: number, pw: number, ph: number): void {
    this.flush();
    const sx = pw / w, sy = ph / h, c = Math.cos(angle * D2R), s = Math.sin(angle * D2R);
    const cx = x + w / 2, cy = y + h / 2, pcx = px + pw / 2, pcy = py + ph / 2;
    this.m = [c * sx, -s * sy, s * sx, c * sy, pcx - (c * cx + s * cy) * sx, pcy - (-s * cx + c * cy) * sy];
    const gl = this.gl;
    const full = px <= 0 && py <= 0 && px + pw >= this.tw && py + ph >= this.th;
    if (full) gl.disable(gl.SCISSOR_TEST);
    else {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(Math.round(px), Math.round(this.target === WINDOW ? this.th - py - ph : py), Math.round(pw), Math.round(ph));
    }
  }
  clear(color: number, alpha: number): void {
    this.flush();
    const gl = this.gl;
    gl.clearColor((color & 255) / 255, ((color >> 8) & 255) / 255, ((color >> 16) & 255) / 255, alpha);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  setBlend(src: number, dst: number, srcA: number, dstA: number): void {
    this.flush();
    const gl = this.gl;
    gl.blendFuncSeparate(factor(gl, src), factor(gl, dst), factor(gl, srcA), factor(gl, dstA));
  }
  setFog(on: boolean, color: number): void {
    this.flush();
    // The default program's fog; a GM shader does its own (gm_PS_FogEnabled), which krplayer leaves off.
    const gl = this.gl, sh = this.shaders[this.shader];
    if (sh) gl.useProgram(this.prog);
    gl.uniform4f(this.uFog, (color & 255) / 255, ((color >> 8) & 255) / 255, ((color >> 16) & 255) / 255, on ? 1 : 0);
    if (sh) gl.useProgram(sh.p);
  }
  setColorWrite(r: boolean, g: boolean, b: boolean, a: boolean): void { this.flush(); this.gl.colorMask(r, g, b, a); }
  setFilter(on: boolean): void { if (on !== this.filter) { this.flush(); this.filter = on; this.cur = -2; } }
  systemText(): void {}

  private use(t: TextureId): Tex | null {
    const x = this.tex[t];
    if (!x) return null;
    if (t !== this.cur) {
      this.flush();
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, x.t);
      this.params();
      this.cur = t;
    }
    if (this.n + 6 > MAX_QUADS * 6) this.flush();
    return x;
  }

  private vert(x: number, y: number, u: number, v: number, rgba: number): void {
    const m = this.m, o = this.n * FLOATS;
    this.f32[o] = m[0] * x + m[2] * y + m[4]; this.f32[o + 1] = m[1] * x + m[3] * y + m[5];
    this.f32[o + 2] = u; this.f32[o + 3] = v; this.u32[o + 4] = rgba;
    this.n++;
  }

  drawImage(t: TextureId, sx: number, sy: number, sw: number, sh: number, x: number, y: number, ox: number, oy: number,
    xs: number, ys: number, rot: number, color: number, alpha: number): void {
    if (alpha <= 0) return;
    const tx = this.use(t);
    if (!tx) return;
    const c = Math.cos(rot * D2R), s = Math.sin(rot * D2R), col = rgba(color, alpha);
    const u0 = sx / tx.w, v0 = sy / tx.h, u1 = (sx + sw) / tx.w, v1 = (sy + sh) / tx.h;
    const l = -ox * xs, tp = -oy * ys, r = (sw - ox) * xs, b = (sh - oy) * ys;
    const X = (px: number, py: number) => x + px * c + py * s, Y = (px: number, py: number) => y - px * s + py * c;
    const x1 = X(l, tp), y1 = Y(l, tp), x2 = X(r, tp), y2 = Y(r, tp), x3 = X(r, b), y3 = Y(r, b), x4 = X(l, b), y4 = Y(l, b);
    this.vert(x1, y1, u0, v0, col); this.vert(x2, y2, u1, v0, col); this.vert(x3, y3, u1, v1, col);
    this.vert(x1, y1, u0, v0, col); this.vert(x3, y3, u1, v1, col); this.vert(x4, y4, u0, v1, col);
  }
  drawQuad(t: TextureId, sx: number, sy: number, sw: number, sh: number, x1: number, y1: number, x2: number, y2: number,
    x3: number, y3: number, x4: number, y4: number, c1: number, c2: number, c3: number, c4: number, alpha: number): void {
    if (alpha <= 0) return;
    const tx = this.use(t);
    if (!tx) return;
    const u0 = sx / tx.w, v0 = sy / tx.h, u1 = (sx + sw) / tx.w, v1 = (sy + sh) / tx.h;
    const k1 = rgba(c1, alpha), k2 = rgba(c2, alpha), k3 = rgba(c3, alpha), k4 = rgba(c4, alpha);
    this.vert(x1, y1, u0, v0, k1); this.vert(x2, y2, u1, v0, k2); this.vert(x3, y3, u1, v1, k3);
    this.vert(x1, y1, u0, v0, k1); this.vert(x3, y3, u1, v1, k3); this.vert(x4, y4, u0, v1, k4);
  }
  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c1: number, c2: number, c3: number, alpha: number): void {
    if (alpha <= 0 || !this.use(this.white)) return;
    this.vert(x1, y1, 0.5, 0.5, rgba(c1, alpha)); this.vert(x2, y2, 0.5, 0.5, rgba(c2, alpha)); this.vert(x3, y3, 0.5, 0.5, rgba(c3, alpha));
  }
  triangleTex(t: TextureId, x1: number, y1: number, u1: number, v1: number, c1: number, x2: number, y2: number, u2: number, v2: number, c2: number,
    x3: number, y3: number, u3: number, v3: number, c3: number, alpha: number): void {
    if (alpha <= 0 || !this.use(t)) return;
    this.vert(x1, y1, u1, v1, rgba(c1, alpha)); this.vert(x2, y2, u2, v2, rgba(c2, alpha)); this.vert(x3, y3, u3, v3, rgba(c3, alpha));
  }

  private flush(): void {
    if (!this.n) return;
    const gl = this.gl;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.f32, 0, this.n * FLOATS);
    gl.drawArrays(gl.TRIANGLES, 0, this.n);
    this.n = 0;
  }
}

/** BGR colour + alpha -> little-endian RGBA8 packed in a uint32. */
function rgba(bgr: number, alpha: number): number {
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  return ((a << 24) | (bgr & 0xffffff)) >>> 0;
}

// ---------------------------------------------------------------- audio

class WebAudio implements Audio {
  readonly ctx = new AudioContext();
  private readonly master = this.ctx.createGain();
  private readonly buffers: (AudioBuffer | null)[] = [null];
  private readonly voices = new Map<number, { buf: AudioBuffer; src: AudioBufferSourceNode | null; gain: GainNode; pitch: number; loop: boolean; started: number; offset: number; paused: boolean; ended: boolean }>();
  private next = 1;

  constructor() { this.master.connect(this.ctx.destination); }

  async load(url: string): Promise<number> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`failed to load ${url} (${r.status})`);
    const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
    this.buffers.push(buf);
    return this.buffers.length - 1;
  }
  length(snd: number): number { return this.buffers[snd]?.duration ?? 0; }

  private start(id: number): void {
    const v = this.voices.get(id)!;
    const src = this.ctx.createBufferSource();
    src.buffer = v.buf; src.loop = v.loop; src.playbackRate.value = v.pitch;
    src.connect(v.gain);
    src.onended = () => { if (v.src === src && !v.paused) v.ended = true; };
    src.start(0, Math.max(0, v.offset % Math.max(v.buf.duration, 1e-6)));
    v.src = src; v.started = this.ctx.currentTime; v.ended = false;
  }
  play(snd: number, loop: boolean, gain: number, pitch: number, offset: number): VoiceId {
    const buf = this.buffers[snd], id = this.next++;
    if (!buf) return id;
    const g = this.ctx.createGain();
    g.gain.value = gain; g.connect(this.master);
    this.voices.set(id, { buf, src: null, gain: g, pitch, loop, started: 0, offset, paused: false, ended: false });
    this.start(id);
    return id;
  }
  stop(id: VoiceId): void {
    const v = this.voices.get(id);
    if (!v) return;
    v.ended = true;
    try { v.src?.stop(); } catch { /* already stopped */ }
    v.gain.disconnect();
    this.voices.delete(id);
  }
  pause(id: VoiceId, paused: boolean): void {
    const v = this.voices.get(id);
    if (!v || v.paused === paused || v.ended) return;
    if (paused) { v.offset = this.position(id); v.paused = true; try { v.src?.stop(); } catch { /* */ } v.src = null; }
    else { v.paused = false; this.start(id); }
  }
  isPlaying(id: VoiceId): boolean { const v = this.voices.get(id); return !!v && (v.paused || !v.ended); }
  setGain(id: VoiceId, gain: number, ms: number): void {
    const v = this.voices.get(id);
    if (!v) return;
    const g = v.gain.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (ms > 0) g.linearRampToValueAtTime(gain, now + ms / 1000); else g.setValueAtTime(gain, now);
  }
  setPitch(id: VoiceId, pitch: number): void {
    const v = this.voices.get(id);
    if (!v) return;
    v.offset = this.position(id); v.started = this.ctx.currentTime; v.pitch = pitch;
    if (v.src) v.src.playbackRate.value = pitch;
  }
  setLoop(id: VoiceId, loop: boolean): void { const v = this.voices.get(id); if (v) { v.loop = loop; if (v.src) v.src.loop = loop; } }
  position(id: VoiceId): number {
    const v = this.voices.get(id);
    if (!v) return 0;
    if (v.paused || !v.src) return v.offset;
    const t = v.offset + (this.ctx.currentTime - v.started) * v.pitch;
    return v.loop ? t % v.buf.duration : Math.min(t, v.buf.duration);
  }
  seek(id: VoiceId, s: number): void {
    const v = this.voices.get(id);
    if (!v) return;
    v.offset = s;
    if (v.src && !v.paused) { try { v.src.stop(); } catch { /* */ } this.start(id); }
  }
  setMasterGain(g: number): void { this.master.gain.value = g; }
}

/** Image files -> RGBA via a 2D canvas (not WebGL: strips can be wider than the max texture size). */
async function decodeImage(bytes: Uint8Array): Promise<Pixels> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!;
  c.drawImage(bmp, 0, 0);
  bmp.close();
  return { w: c.canvas.width, h: c.canvas.height, data: c.getImageData(0, 0, c.canvas.width, c.canvas.height).data };
}

/** font_add: TTF/OTF files become FontFaces; glyphs are drawn white into a 2D canvas atlas. */
class CanvasFonts implements FontRasterizer {
  private readonly names: string[] = [];
  async load(bytes: Uint8Array): Promise<number> {
    const name = `kr_font_${this.names.length}`, face = new FontFace(name, bytes.slice().buffer);
    try { await face.load(); } catch { return -1; }
    document.fonts.add(face);
    this.names.push(name);
    return this.names.length - 1;
  }
  raster(font: number, px: number, bold: boolean, italic: boolean, first: number, last: number, antialias: boolean) {
    const css = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${px}px "${this.names[font]}"`;
    const m = new OffscreenCanvas(1, 1).getContext('2d')!;
    m.font = css;
    const fm = m.measureText('Mg'), ascent = Math.ceil(fm.fontBoundingBoxAscent), lineHeight = Math.max(1, ascent + Math.ceil(fm.fontBoundingBoxDescent));
    // Each cell is padded so overhangs aren't clipped; the glyph offset undoes the padding.
    const PAD = 2, ROW = 1024, glyphs: number[][] = [];
    let x = 0, y = 0;
    for (let ch = first; ch <= last; ch++) {
      const adv = m.measureText(String.fromCodePoint(ch)).width, w = Math.ceil(adv) + PAD * 2;
      if (x + w > ROW) { x = 0; y += lineHeight; }
      glyphs.push([ch, x, y, w, lineHeight, Math.round(adv), -PAD]);
      x += w;
    }
    const c = new OffscreenCanvas(ROW, y + lineHeight).getContext('2d')!;
    c.font = css; c.fillStyle = '#fff'; c.textBaseline = 'alphabetic';
    for (const [ch, gx, gy] of glyphs) c.fillText(String.fromCodePoint(ch), gx + PAD, gy + ascent);
    const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height), d = img.data;
    for (let i = 3; i < d.length; i += 4) {
      if (!antialias) d[i] = d[i] >= 128 ? 255 : 0;
      d[i - 3] = d[i - 2] = d[i - 1] = 255; // white glyphs, tinted by the draw colour
    }
    return { atlas: { w: img.width, h: img.height, data: d }, glyphs, lineHeight };
  }
}

/** Keys whose browser default (scrolling, focus moves) would get in the way of a game. */
const SWALLOW = new Set([8, 9, 13, 32, 33, 34, 35, 36, 37, 38, 39, 40, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122]);

export function createWebPlatform(canvas: HTMLCanvasElement): Platform & { audioContext: AudioContext } {
  const input = { keys: new Uint8Array(256), pressed: new Uint8Array(256), released: new Uint8Array(256), mouseX: 0, mouseY: 0, mouseButtons: 0, mousePressed: 0, mouseReleased: 0, wheel: 0, typed: '', lastKey: 0 };
  // GM key codes are Windows virtual-key codes, which KeyboardEvent.keyCode still reports.
  addEventListener('keydown', (e) => {
    const k = e.keyCode & 255;
    if (!input.keys[k]) { input.pressed[k] = 1; input.lastKey = k; }
    input.keys[k] = 1;
    // GM's vk_shift/vk_control/vk_alt are also set for either side.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) input.typed += e.key;
    if (SWALLOW.has(k) && !(k === 122)) e.preventDefault();
  });
  addEventListener('keyup', (e) => {
    const k = e.keyCode & 255;
    if (input.keys[k]) input.released[k] = 1;
    input.keys[k] = 0;
  });
  addEventListener('blur', () => input.keys.fill(0));
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    input.mouseX = ((e.clientX - r.left) / r.width) * canvas.width; input.mouseY = ((e.clientY - r.top) / r.height) * canvas.height;
  });
  const bit = (e: MouseEvent) => 1 << ([0, 2, 1][e.button] ?? 0);
  canvas.addEventListener('mousedown', (e) => { input.mouseButtons |= bit(e); input.mousePressed |= bit(e); });
  addEventListener('mouseup', (e) => { if (input.mouseButtons & bit(e)) input.mouseReleased |= bit(e); input.mouseButtons &= ~bit(e); });
  canvas.addEventListener('wheel', (e) => { if (e.deltaY) input.wheel += e.deltaY < 0 ? 1 : -1; }, { passive: true });
  const audio = new WebAudio();
  return {
    renderer: new GLRenderer(canvas),
    audio,
    audioContext: audio.ctx,
    input,
    storage: new FileStore(idbBackend()),
    now: () => performance.now(),
    hidden: () => document.hidden,
    setFullscreen: (on) => { if (on && !document.fullscreenElement) canvas.parentElement?.requestFullscreen().catch(() => {}); else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {}); },
    isFullscreen: () => !!document.fullscreenElement,
    setTitle: (t) => { document.title = t; },
    log: (m) => console.log(m),
    fetchBytes: async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`failed to load ${url} (${r.status})`);
      return new Uint8Array(await r.arrayBuffer());
    },
    decodeImage,
    fonts: new CanvasFonts(),
    ask: (text, def) => prompt(text, def),
  };
}
