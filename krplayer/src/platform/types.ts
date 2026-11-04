// Everything the runtime needs from the outside world. The runtime never touches the DOM,
// WebGL, WebAudio or fetch directly, so it can run headless (Node tests, trace comparisons).
// Grow these as builtins need them; keep arguments flat (no per-call objects) for the hot loop.

export type TextureId = number;
export type SoundId = number;
export type VoiceId = number;

export interface Renderer {
  loadTexture(url: string): Promise<TextureId>;
  beginFrame(): void;
  endFrame(): void;
  /** color is GML BGR. */
  clear(color: number, alpha: number): void;
  drawImage(
    tex: TextureId, sx: number, sy: number, sw: number, sh: number,
    x: number, y: number, xscale: number, yscale: number, rot: number, color: number, alpha: number,
  ): void;
}

export interface Audio {
  load(url: string, stream: boolean): Promise<SoundId>;
  play(snd: SoundId, loop: boolean, gain: number): VoiceId;
  stop(voice: VoiceId): void;
}

export interface Input {
  /** Indexed by GML key code; 1 while held. The runtime derives pressed/released per step. */
  readonly keys: Uint8Array;
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
