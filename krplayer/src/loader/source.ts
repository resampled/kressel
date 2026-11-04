// Where a project comes from: a URL (the CDN / dev server), or files in memory (a zip the user
// picked, or a project handed over by gm2kr). Either way the runtime gets a .krpj plus a
// function that turns its asset paths into URLs.

import type { Krpj } from '../krpj.ts';
import { resolveAsset, type KrConfig } from '../config.ts';
import { readZip } from './zip.ts';

export interface ProjectSource {
  krpj: Krpj;
  /** Asset path from the .krpj ("./x" or "/sa/~alias/x") -> URL. */
  url(path: string): string;
}

const MAIN = 'game.krpj';

function parse(text: string, where: string): Krpj {
  let pj: Krpj;
  try { pj = JSON.parse(text); } catch (e) { throw new Error(`${where}: not valid JSON (${(e as Error).message})`); }
  if (!pj || typeof pj !== 'object' || typeof pj.krpj_v !== 'string') throw new Error(`${where}: not a .krpj (no krpj_v)`);
  return pj;
}

/** A .krpj on the web; "./x" assets resolve next to it unless cfg says otherwise. */
export async function fromUrl(src: string, cfg?: Partial<KrConfig>): Promise<ProjectSource> {
  const url = new URL(src, location.href);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url} (${res.status})`);
  const full: KrConfig = { projectBase: cfg?.projectBase ?? new URL('.', url).href, sharedAssetBase: cfg?.sharedAssetBase ?? '/kr/sa/' };
  return { krpj: parse(await res.text(), url.href), url: (p) => resolveAsset(full, p) };
}

/** In-memory project files keyed by path ("game.krpj", "sprites/x/0.png"...). Makes blob URLs. */
export function fromFiles(files: Map<string, Uint8Array>, sharedAssetBase = '/kr/sa/'): ProjectSource {
  const main = files.get(MAIN) ?? [...files].find(([k]) => k.endsWith('/' + MAIN))?.[1];
  if (!main) throw new Error(`no ${MAIN} in the project files`);
  const blobs = new Map<string, string>();
  return {
    krpj: parse(new TextDecoder().decode(main), MAIN),
    url: (p) => {
      if (p.startsWith('/sa/')) return resolveAsset({ projectBase: '', sharedAssetBase }, p);
      if (!p.startsWith('./')) throw new Error(`unrecognised asset path "${p}" (expected ./ or /sa/)`);
      const key = p.slice(2);
      let u = blobs.get(key);
      if (!u) {
        const data = files.get(key);
        if (!data) throw new Error(`asset ${p} is missing from the project files`);
        u = URL.createObjectURL(new Blob([data as BlobPart], { type: key.endsWith('.png') ? 'image/png' : 'application/octet-stream' }));
        blobs.set(key, u);
      }
      return u;
    },
  };
}

export async function fromZip(bytes: Uint8Array, sharedAssetBase?: string): Promise<ProjectSource> {
  return fromFiles(await readZip(bytes), sharedAssetBase);
}
