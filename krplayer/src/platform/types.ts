// Everything the runtime needs from the outside world. The runtime never touches the DOM,
// WebGL, WebAudio or fetch directly, so it can run headless (Node tests, trace comparisons).
// Keep arguments flat (no per-call objects) for the hot loop.

export type TextureId = number;
export type SoundId = number;
export type VoiceId = number;

/** Decoded RGBA8 pixels, rows top to bottom. */
export interface Pixels { w: number; h: number; data: Uint8ClampedArray }

/** The window (canvas) render target. */
export const WINDOW = -1;

export interface Renderer {
  loadTexture(url: string): Promise<TextureId>;
  /** [width, height] of a loaded texture or surface. */
  textureSize(tex: TextureId): [number, number];
  /** Resizes the window (canvas). */
  setWindowSize(w: number, h: number): void;
  windowSize(): [number, number];
  beginFrame(): void;
  endFrame(): void;
  /** A texture that can be drawn into (GM surface). */
  createSurface(w: number, h: number): TextureId;
  freeSurface(tex: TextureId): void;
  /** A texture from RGBA pixels, synchronously (runtime sprites: sprite_add, font_add). */
  createTexture(px: Pixels): TextureId;
  /** A surface's pixels, top row first (buffer_get_surface). */
  readPixels(tex: TextureId): Pixels;
  /** Copies a rectangle of a texture into a new texture (sprite_create_from_surface). */
  copyTexture(tex: TextureId, x: number, y: number, w: number, h: number): TextureId;
  /** Where drawing goes: a surface, or WINDOW. Resets the view to the target's own pixels. */
  setTarget(tex: TextureId): void;
  /** Maps the world rectangle (x, y, w, h), rotated by angle (degrees), onto (px, py, pw, ph) of the target. */
  setView(x: number, y: number, w: number, h: number, angle: number, px: number, py: number, pw: number, ph: number): void;
  /** Clears the whole current target. color is GML BGR. */
  clear(color: number, alpha: number): void;
  /** Blend factors (GM bm_* constants: 1 zero, 2 one, 3 src_colour ... see gpu_set_blendmode_ext). */
  setBlend(src: number, dst: number, srcA: number, dstA: number): void;
  /** Fog replaces the colour of everything drawn (alpha kept), as Deltarune uses it for flashes. */
  setFog(on: boolean, color: number): void;
  setColorWrite(r: boolean, g: boolean, b: boolean, a: boolean): void;
  /** Linear texture filtering on/off (gpu_set_texfilter). */
  setFilter(on: boolean): void;
  /** Draws [sx, sy, sw, sh] of tex with its (ox, oy) pixel at (x, y), scaled, then rotated (degrees, counter-clockwise). */
  drawImage(
    tex: TextureId, sx: number, sy: number, sw: number, sh: number,
    x: number, y: number, ox: number, oy: number, xscale: number, yscale: number, rot: number, color: number, alpha: number,
  ): void;
  /** [sx, sy, sw, sh] of tex onto an arbitrary quad (corners clockwise from top-left), with per-corner colours. */
  drawQuad(
    tex: TextureId, sx: number, sy: number, sw: number, sh: number,
    x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number,
    c1: number, c2: number, c3: number, c4: number, alpha: number,
  ): void;
  /** A filled triangle with per-vertex colours. */
  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c1: number, c2: number, c3: number, alpha: number): void;
  /** Text in a built-in fallback font (GM's default font when none is set). */
  systemText(text: string, x: number, y: number, color: number, alpha: number): void;
}

export interface Audio {
  /** Fetches and decodes a sound. */
  load(url: string, stream: boolean): Promise<SoundId>;
  /** Length in seconds (0 until loaded). */
  length(snd: SoundId): number;
  play(snd: SoundId, loop: boolean, gain: number, pitch: number, offset: number): VoiceId;
  stop(voice: VoiceId): void;
  pause(voice: VoiceId, paused: boolean): void;
  isPlaying(voice: VoiceId): boolean;
  /** Ramps a voice's gain over ms milliseconds. */
  setGain(voice: VoiceId, gain: number, ms: number): void;
  setPitch(voice: VoiceId, pitch: number): void;
  setLoop(voice: VoiceId, loop: boolean): void;
  /** Playback position in seconds. */
  position(voice: VoiceId): number;
  seek(voice: VoiceId, seconds: number): void;
  setMasterGain(gain: number): void;
}

export interface Input {
  /** Indexed by GML key code; 1 while held. */
  readonly keys: Uint8Array;
  /** Latched by the platform when a key goes down/up; the runtime clears them after each step. */
  readonly pressed: Uint8Array;
  readonly released: Uint8Array;
  mouseX: number;
  mouseY: number;
  /** Bit 0 left, 1 right, 2 middle. */
  mouseButtons: number;
  /** Characters typed since the last step (keyboard_string), and the last key code pressed. */
  typed: string;
  lastKey: number;
}

/** Saved files of one project (keys are paths). See platform/filestore.ts. */
export interface Storage {
  /** Selects the project partition (cfg_db_relay.slug) and loads its files; call before the game starts. */
  open(project: string): Promise<void>;
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
  /** Keys starting with prefix. Writes over the project's quota are refused. */
  keys(prefix: string): string[];
}

/** Runtime fonts from font files (font_add). */
export interface FontRasterizer {
  /** Registers a TTF/OTF file; returns a handle, or -1 if it can't be parsed. */
  load(bytes: Uint8Array): Promise<number>;
  /**
   * Renders chars first..last at px pixels into one atlas. Glyphs are [char, x, y, w, h, shift, offset]
   * in GM's font glyph layout; lineHeight is the cell height.
   */
  raster(font: number, px: number, bold: boolean, italic: boolean, first: number, last: number, antialias: boolean): { atlas: Pixels; glyphs: number[][]; lineHeight: number };
}

export interface Platform {
  renderer: Renderer;
  audio: Audio;
  input: Input;
  storage: Storage;
  /** Milliseconds, monotonic. */
  now(): number;
  /** Whether the page is hidden (os_is_paused). */
  hidden(): boolean;
  /** Fullscreen toggle (needs a user gesture in browsers; may apply later). */
  setFullscreen(on: boolean): void;
  isFullscreen(): boolean;
  setTitle(title: string): void;
  log(msg: string): void;
  /** Reads a project file (included files) by URL. */
  fetchBytes(url: string): Promise<Uint8Array>;
  /** Decodes an image file (PNG/JPEG/GIF) to RGBA. Absent: sprite_add and friends fail. */
  decodeImage?(bytes: Uint8Array): Promise<Pixels>;
  /** Absent: font_add fails. */
  fonts?: FontRasterizer;
  /** A blocking text prompt (get_string); null if cancelled. Absent: the default is returned. */
  ask?(prompt: string, def: string): string | null;
}
