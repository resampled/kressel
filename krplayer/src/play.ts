// Project source + platform -> a Game. Shared by the browser entry and headless runs.

import type { Platform } from './platform/types.ts';
import type { ProjectSource } from './loader/source.ts';
import { loadAssets } from './runtime/assets.ts';
import { Game } from './runtime/game.ts';
import { UNPUBLISHED } from './platform/filestore.ts';

/** The saved-file partition: the slug, "_"-prefixed for local projects (published slugs must not start with "_"). */
export function partition(source: ProjectSource): string {
  const slug = source.krpj.cfg_db_relay?.slug;
  return !slug ? UNPUBLISHED : source.local ? '_' + slug : slug;
}

/** Loads and compiles a project; call game.start() to run its global init and first room. */
export async function prepare(source: ProjectSource, platform: Platform, progress?: (msg: string) => void): Promise<Game> {
  const [assets] = await Promise.all([loadAssets(source.krpj, source.url, platform, progress), platform.storage.open(partition(source))]);
  return new Game(assets, platform);
}

export async function load(source: ProjectSource, platform: Platform, progress?: (msg: string) => void): Promise<Game> {
  const game = await prepare(source, platform, progress);
  game.start();
  return game;
}
