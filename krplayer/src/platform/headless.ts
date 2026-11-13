// Headless platform: deterministic clock, scriptable input, silent audio, in-memory storage. For tests
// and traces. Rendering uses SoftRenderer when given a texture decoder (screenshots), else only counts.

import type { Audio, FontRasterizer, Platform, Renderer } from './types.ts';
import { SoftRenderer, type Pixels } from './soft.ts';
import { FileStore, memoryBackend } from './filestore.ts';

export interface HeadlessPlatform extends Platform {
  /** Advances the fake clock. */
  tick(ms: number): void;
  /** Simulates a key going down (true) or up (false). */
  key(code: number, down: boolean): void;
  stats: { frames: number; draws: number; sounds: number; log: string[] };
  /** The software renderer (pixels), when the platform was created with a decoder. */
  soft: SoftRenderer | null;
}

/** Optional host decoders (Node has no image or font decoding of its own). */
export interface HeadlessExtras { decodeImage?: (bytes: Uint8Array) => Promise<Pixels>; fonts?: FontRasterizer; alert?: (text: string) => void; confirm?: (text: string) => boolean }

export function createHeadless(textureSize: (url: string) => [number, number] = () => [1, 1], decode?: (url: string) => Promise<Pixels>,
  fetchBytes: (url: string) => Promise<Uint8Array> = async (u) => { throw new Error(`headless: no file ${u}`); }, extras: HeadlessExtras = {}): HeadlessPlatform {
  let time = 0, nextId = 1;
  const sizes = new Map<number, [number, number]>();
  const stats = { frames: 0, draws: 0, sounds: 0, log: [] as string[] };
  const input = { keys: new Uint8Array(256), pressed: new Uint8Array(256), released: new Uint8Array(256), mouseX: 0, mouseY: 0, mouseButtons: 0, mousePressed: 0, mouseReleased: 0, wheel: 0, typed: '', lastKey: 0 };
  let win: [number, number] = [640, 480];
  const counting: Renderer = {
    loadTexture: async (url) => { const id = nextId++; sizes.set(id, textureSize(url)); return id; },
    textureSize: (tex) => sizes.get(tex) ?? [0, 0],
    setWindowSize: (w, h) => { win = [w, h]; }, windowSize: () => win,
    beginFrame() {}, endFrame() { stats.frames++; },
    createSurface: (w, h) => { const id = nextId++; sizes.set(id, [w, h]); return id; },
    freeSurface: (t) => { sizes.delete(t); },
    readPixels: (t) => { const [w, h] = sizes.get(t) ?? [0, 0]; return { w, h, data: new Uint8ClampedArray(w * h * 4) }; },
    createTexture: (px) => { const id = nextId++; sizes.set(id, [px.w, px.h]); return id; },
    copyTexture: (_t, _x, _y, w, h) => { const id = nextId++; sizes.set(id, [w, h]); return id; },
    setTarget() {}, setView() {}, clear() {}, setBlend() {}, setFog() {}, setAlphaTest() {}, setColorWrite() {}, setFilter() {}, setRepeat() {},
    drawImage() { stats.draws++; }, drawQuad() { stats.draws++; }, triangle() { stats.draws++; }, triangleTex() { stats.draws++; }, systemText() {},
    compileShader: () => nextId++, setShader() {}, shaderUniform: () => nextId++, setUniformF() {}, setSampler() {},
  };
  const soft = decode ? new SoftRenderer(decode) : null;
  if (soft) { const end = soft.endFrame.bind(soft); soft.endFrame = () => { stats.frames++; stats.draws += soft.draws; end(); }; }
  // Every sound lasts one second of fake time (looping ones until stopped).
  const voices = new Map<number, number>();
  const audio: Audio = {
    load: async () => nextId++, length: () => 1,
    play: (_s, loop) => { stats.sounds++; const v = nextId++; voices.set(v, loop ? Infinity : time + 1000); return v; },
    stop: (v) => { voices.delete(v); }, pause() {}, isPlaying: (v) => (voices.get(v) ?? -1) > time,
    setGain() {}, setPitch() {}, setLoop() {}, position: () => 0, seek() {}, setMasterGain() {}, setPanner() {}, setListener() {},
  };
  return {
    stats, soft,
    tick: (ms) => { time += ms; },
    key: (code, down) => {
      if (down && !input.keys[code]) { input.pressed[code] = 1; input.lastKey = code; }
      if (!down && input.keys[code]) input.released[code] = 1;
      input.keys[code] = down ? 1 : 0;
    },
    now: () => time,
    renderer: soft ?? counting,
    audio,
    input,
    storage: new FileStore(memoryBackend(), (m) => { stats.log.push(m); }),
    hidden: () => false, setFullscreen() {}, isFullscreen: () => false, setTitle() {},
    log: (m) => { stats.log.push(m); },
    fetchBytes, ...extras,
  };
}
