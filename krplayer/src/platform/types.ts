// Everything the runtime needs from the outside world. The runtime never touches the DOM,
// WebGL, WebAudio or fetch directly, so it can run headless (Node tests, trace comparisons).
// Grow these as builtins need them; keep arguments flat (no per-call objects) for the hot loop.

export type TextureId = number;
export type SoundId = number;
export type VoiceId = number;

export interface Renderer {
  loadTexture(url: string): Promise<TextureId>;
  /** [width, height] of a loaded texture. */
  textureSize(tex: TextureId): Promise<[number, number]>;
  /** Starts a frame on a w x h surface (the application surface / GUI size). */
  beginFrame(w: number, h: number): void;
  endFrame(): void;
  /** color is GML BGR. */
  clear(color: number, alpha: number): void;
  /** Draws [sx, sy, sw, sh] of tex with its (ox, oy) pixel at (x, y), scaled, then rotated (degrees, counter-clockwise). */
  drawImage(
    tex: TextureId, sx: number, sy: number, sw: number, sh: number,
    x: number, y: number, ox: number, oy: number, xscale: number, yscale: number, rot: number, color: number, alpha: number,
  ): void;
  rect(x1: number, y1: number, x2: number, y2: number, color: number, alpha: number, outline: boolean): void;
  circle(x: number, y: number, r: number, color: number, alpha: number, outline: boolean): void;
  /** Text in a built-in fallback font (GM's default font when none is set). */
  systemText(text: string, x: number, y: number, color: number, alpha: number): void;
}

export interface Audio {
  load(url: string, stream: boolean): Promise<SoundId>;
  play(snd: SoundId, loop: boolean, gain: number): VoiceId;
  stop(voice: VoiceId): void;
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
}

export interface Storage {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

export interface Platform {
  renderer: Renderer;
  audio: Audio;
  input: Input;
  storage: Storage;
  /** Milliseconds, monotonic. */
  now(): number;
}
