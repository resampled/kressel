// gm2kr page: pick a GameMaker game folder, convert its data.win, then download the project
// as a .krpj or hand it straight to krplayer (see krplayer/src/loader/handoff.ts).
// The player URL comes from <meta name="gm2kr-player-url" content="...">, never hardcoded.

import { convert, type GameFiles } from './convert.ts';
import { zip } from './emit/zip.ts';
import { sendToPlayer } from '../../krplayer/src/loader/handoff.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('input'), playBtn = $<HTMLButtonElement>('play'), dlBtn = $<HTMLButtonElement>('download');
const log = (msg: string) => { $('log').textContent += msg + '\n'; };
const playerUrl = document.querySelector('meta[name="gm2kr-player-url"]')?.getAttribute('content') ?? '';

let files: Map<string, Uint8Array> | null = null, slug = 'game';

input.addEventListener('change', async () => {
  $('log').textContent = '';
  files = null;
  playBtn.disabled = dlBtn.disabled = true;
  const picked = [...(input.files ?? [])];
  const dataWin = picked.find((f) => f.name.toLowerCase() === 'data.win');
  if (!dataWin) return log('error: no data.win found in selection');
  // Everything else in the folder, by path relative to data.win (audio groups, external sounds, included files).
  const root = dataWin.webkitRelativePath.slice(0, dataWin.webkitRelativePath.length - dataWin.name.length);
  const extra: GameFiles = new Map();
  for (const f of picked) {
    if (f === dataWin || !f.webkitRelativePath.startsWith(root)) continue;
    extra.set(f.webkitRelativePath.slice(root.length), async () => new Uint8Array(await f.arrayBuffer()));
  }
  try {
    const t0 = performance.now();
    const out = await convert(await dataWin.arrayBuffer(), extra, log);
    files = out.files; slug = out.krpj.cfg_db_relay.slug || 'game';
    const k = out.krpj;
    log(`converted "${k.cfg_db_relay.title}" in ${Math.round(performance.now() - t0)} ms`);
    log(`  ${Object.keys(k.objects ?? {}).length} objects, ${Object.keys(k.rooms ?? {}).length} rooms, ${Object.keys(k.functions ?? {}).length} functions, ${Object.keys(k.sprites).length} sprites, ${Object.keys(k.sounds).length} sounds, ${Object.keys(k.included_files ?? {}).length} included files, ${files.size} files`);
    dlBtn.disabled = false;
    playBtn.disabled = !playerUrl;
    if (!playerUrl) log('(no gm2kr-player-url configured: Play is disabled)');
  } catch (e) {
    log(`error: ${(e as Error).message}`);
    console.error(e);
  }
});

dlBtn.addEventListener('click', () => {
  if (!files) return;
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([zip(files) as BlobPart], { type: 'application/zip' })),
    download: `${slug}.krpj`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});

playBtn.addEventListener('click', () => {
  if (!files) return;
  try { sendToPlayer(playerUrl, files); } catch (e) { log(`error: ${(e as Error).message}`); }
});
