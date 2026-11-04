// Headless platform: no output, deterministic clock, scriptable input. For tests and traces.

import type { Platform } from './types.ts';

export interface HeadlessPlatform extends Platform {
  /** Advances the fake clock. */
  tick(ms: number): void;
  stats: { frames: number; draws: number; sounds: number };
}

export function createHeadless(): HeadlessPlatform {
  let time = 0, nextId = 1;
  const store = new Map<string, string>();
  const stats = { frames: 0, draws: 0, sounds: 0 };
  return {
    stats,
    tick: (ms) => { time += ms; },
    now: () => time,
    renderer: {
      loadTexture: async () => nextId++,
      beginFrame() {},
      endFrame() { stats.frames++; },
      clear() {},
      drawImage() { stats.draws++; },
    },
    audio: {
      load: async () => nextId++,
      play: () => { stats.sounds++; return nextId++; },
      stop() {},
    },
    input: { keys: new Uint8Array(256), mouseX: 0, mouseY: 0, mouseButtons: 0 },
    storage: { read: (k) => store.get(k) ?? null, write: (k, v) => { store.set(k, v); } },
  };
}
