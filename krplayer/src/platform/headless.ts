// Headless platform: deterministic clock, scriptable input, silent audio, in-memory storage. For tests
// and traces. Rendering uses SoftRenderer when given a texture decoder (screenshots), else only counts.

import type { Audio, Platform, Renderer } from './types.ts';
import { SoftRenderer, type Pixels } from './soft.ts';

export interface HeadlessPlatform extends Platform {
  /** Advances the fake clock. */
  tick(ms: number): void;
  /** Simulates a key going down (true) or up (false). */
  key(code: number, down: boolean): void;
  stats: { frames: number; draws: number; sounds: number; log: string[] };
  /** The software renderer (pixels), when the platform was created with a decoder. */
  soft: SoftRenderer | null;
}

export function createHeadless(textureSize: (url: string) => [number, number] = () => [1, 1], decode?: (url: string) => Promise<Pixels>,
  fetchBytes: (url: string) => Promise<Uint8Array> = async (u) => { throw new Error(`headless: no file ${u}`); }): HeadlessPlatform {
  let time = 0, nextId = 1;
  const store = new Map<string, string>(), sizes = new Map<number, [number, number]>();
  const stats = { frames: 0, draws: 0, sounds: 0, log: [] as string[] };
  const input = { keys: new Uint8Array(256), pressed: new Uint8Array(256), released: new Uint8Array(256), mouseX: 0, mouseY: 0, mouseButtons: 0, typed: '', lastKey: 0 };
  let win: [number, number] = [640, 480];
  const counting: Renderer = {
    loadTexture: async (url) => { const id = nextId++; sizes.set(id, textureSize(url)); return id; },
    textureSize: (tex) => sizes.get(tex) ?? [0, 0],
    setWindowSize: (w, h) => { win = [w, h]; }, windowSize: () => win,
    beginFrame() {}, endFrame() { stats.frames++; },
    createSurface: (w, h) => { const id = nextId++; sizes.set(id, [w, h]); return id; },
    freeSurface: (t) => { sizes.delete(t); },
    copyTexture: (_t, _x, _y, w, h) => { const id = nextId++; sizes.set(id, [w, h]); return id; },
    setTarget() {}, setView() {}, clear() {}, setBlend() {}, setFog() {}, setColorWrite() {}, setFilter() {},
    drawImage() { stats.draws++; }, drawQuad() { stats.draws++; }, triangle() { stats.draws++; }, systemText() {},
  };
  const soft = decode ? new SoftRenderer(decode) : null;
  if (soft) { const end = soft.endFrame.bind(soft); soft.endFrame = () => { stats.frames++; stats.draws += soft.draws; end(); }; }
  // Every sound lasts one second of fake time (looping ones until stopped).
  const voices = new Map<number, number>();
  const audio: Audio = {
    load: async () => nextId++, length: () => 1,
    play: (_s, loop) => { stats.sounds++; const v = nextId++; voices.set(v, loop ? Infinity : time + 1000); return v; },
    stop: (v) => { voices.delete(v); }, pause() {}, isPlaying: (v) => (voices.get(v) ?? -1) > time,
    setGain() {}, setPitch() {}, setLoop() {}, position: () => 0, seek() {}, setMasterGain() {},
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
    storage: {
      read: (k) => store.get(k) ?? null, write: (k, v) => { store.set(k, v); }, remove: (k) => { store.delete(k); },
      keys: (p) => [...store.keys()].filter((k) => k.startsWith(p)),
    },
    hidden: () => false, setFullscreen() {}, isFullscreen: () => false, setTitle() {},
    log: (m) => { stats.log.push(m); },
    fetchBytes,
  };
}
