// Engine configuration, injected by the host page. Never hardcode a site or CDN here.

export interface KrConfig {
  /** Base for project files ("./x" paths in game.json), e.g. "/kr/pj/<slug>/". */
  projectBase: string;
  /** Base for shared assets ("/sa/~alias/x" paths), e.g. "/kr/sa/". */
  sharedAssetBase: string;
}

/** Resolves an asset path from game.json (see docs/krpj.md) to a URL. */
export function resolveAsset(cfg: KrConfig, path: string): string {
  if (path.startsWith('./')) return cfg.projectBase + path.slice(2);
  if (path.startsWith('/sa/')) return cfg.sharedAssetBase + path.slice(4);
  throw new Error(`unrecognised asset path "${path}" (expected ./ or /sa/)`);
}
