// Headless platform: no output, deterministic clock, scriptable input. For tests and traces.

import type { Platform } from './types.ts';

export interface HeadlessPlatform extends Platform {
  /** Advances the fake clock. */
  tick(ms: number): void;
  /** Simulates a key going down (true) or up (false). */
  key(code: number, down: boolean): void;
  stats: { frames: number; draws: number; sounds: number; texts: string[] };
}

export function createHeadless(textureSize: (url: string) => [number, number] = () => [1, 1]): HeadlessPlatform {
  let time = 0, nextId = 1;
  const store = new Map<string, string>(), sizes = new Map<number, [number, number]>();
  const stats = { frames: 0, draws: 0, sounds: 0, texts: [] as string[] };
  const input = { keys: new Uint8Array(256), pressed: new Uint8Array(256), released: new Uint8Array(256), mouseX: 0, mouseY: 0, mouseButtons: 0 };
  return {
    stats,
    tick: (ms) => { time += ms; },
    key: (code, down) => {
      if (down && !input.keys[code]) input.pressed[code] = 1;
      if (!down && input.keys[code]) input.released[code] = 1;
      input.keys[code] = down ? 1 : 0;
    },
    now: () => time,
    renderer: {
      loadTexture: async (url) => { const id = nextId++; sizes.set(id, textureSize(url)); return id; },
      textureSize: async (tex) => sizes.get(tex) ?? [0, 0],
      beginFrame() { stats.texts.length = 0; },
      endFrame() { stats.frames++; },
      clear() {},
      drawImage() { stats.draws++; },
      rect() { stats.draws++; },
      circle() { stats.draws++; },
      systemText(t) { stats.texts.push(t); },
    },
    audio: {
      load: async () => nextId++,
      play: () => { stats.sounds++; return nextId++; },
      stop() {},
    },
    input,
    storage: { read: (k) => store.get(k) ?? null, write: (k, v) => { store.set(k, v); } },
  };
}
