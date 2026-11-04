// Project source + platform -> a started Game. Shared by the browser entry and headless runs.

import type { Platform } from './platform/types.ts';
import type { ProjectSource } from './loader/source.ts';
import { loadAssets } from './runtime/assets.ts';
import { Game } from './runtime/game.ts';

export async function load(source: ProjectSource, platform: Platform): Promise<Game> {
  const game = new Game(await loadAssets(source.krpj, source.url, platform), platform);
  game.start();
  return game;
}
