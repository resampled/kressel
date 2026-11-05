// Project source + platform -> a Game. Shared by the browser entry and headless runs.

import type { Platform } from './platform/types.ts';
import type { ProjectSource } from './loader/source.ts';
import { loadAssets } from './runtime/assets.ts';
import { Game } from './runtime/game.ts';
import { UNPUBLISHED } from './platform/filestore.ts';

/** Loads and compiles a project; call game.start() to run its global init and first room. */
export async function prepare(source: ProjectSource, platform: Platform, progress?: (msg: string) => void): Promise<Game> {
  const [assets] = await Promise.all([loadAssets(source.krpj, source.url, platform, progress), platform.storage.open(source.krpj.cfg_db_relay?.slug || UNPUBLISHED)]);
  return new Game(assets, platform);
}

export async function load(source: ProjectSource, platform: Platform, progress?: (msg: string) => void): Promise<Game> {
  const game = await prepare(source, platform, progress);
  game.start();
  return game;
}
