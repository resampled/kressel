// Project source + platform -> a Game. Shared by the browser entry and headless runs.

import type { Platform } from './platform/types.ts';
import type { ProjectSource } from './loader/source.ts';
import { loadAssets } from './runtime/assets.ts';
import { Game } from './runtime/game.ts';

/** Loads and compiles a project; call game.start() to run its global init and first room. */
export async function prepare(source: ProjectSource, platform: Platform, progress?: (msg: string) => void): Promise<Game> {
  return new Game(await loadAssets(source.krpj, source.url, platform, progress), platform);
}

export async function load(source: ProjectSource, platform: Platform, progress?: (msg: string) => void): Promise<Game> {
  const game = await prepare(source, platform, progress);
  game.start();
  return game;
}
