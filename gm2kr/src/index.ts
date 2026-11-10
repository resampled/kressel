// gm2kr page: pick a GameMaker game folder, convert its data.win, then download the project
// as a .krpj or hand it straight to krplayer (see krplayer/src/loader/handoff.ts).
// The player URL comes from <meta name="gm2kr-player-url" content="...">, never hardcoded.

import { convert, type GameFiles } from './convert.ts';
import { zip } from './emit/zip.ts';
import { compressOggs } from './emit/ogg.ts';
import { canEncodeOpus, toOpus } from './opus_web.ts';
import { sendToPlayer } from '../../krplayer/src/loader/handoff.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('input'), playBtn = $<HTMLButtonElement>('play'), dlBtn = $<HTMLButtonElement>('download');
const oggBox = $<HTMLInputElement>('ogg'), kbpsBox = $<HTMLInputElement>('kbps');
const log = (msg: string) => { $('log').textContent += msg + '\n'; };
const playerUrl = document.querySelector('meta[name="gm2kr-player-url"]')?.getAttribute('content') ?? '';

/** `converted` is gm2kr's output as is; `files` is what the buttons use (the same, or with .ogg's compressed). */
let converted: Map<string, Uint8Array> | null = null, files: Map<string, Uint8Array> | null = null, slug = 'game';

oggBox.disabled = kbpsBox.disabled = !canEncodeOpus();
if (oggBox.disabled) oggBox.parentElement!.title = 'This browser has no Opus encoder (WebCodecs AudioEncoder)';

/** Applies the .ogg option to the converted project. The controls are off meanwhile, so the buttons never see a half-done set. */
async function pack() {
  if (!converted) return;
  const controls = [input, oggBox, kbpsBox, dlBtn, playBtn];
  for (const c of controls) c.disabled = true;
  files = converted;
  const kbps = Math.min(256, Math.max(16, +kbpsBox.value || 64));
  try {
    if (oggBox.checked) files = await compressOggs(converted, (d) => toOpus(d, kbps), log);
  } catch (e) {
    log(`error: ${(e as Error).message}`);
  }
  for (const c of controls) c.disabled = false;
  playBtn.disabled = !playerUrl;
}
oggBox.addEventListener('change', pack);
kbpsBox.addEventListener('change', () => { if (oggBox.checked) pack(); });

input.addEventListener('change', async () => {
  $('log').textContent = '';
  converted = files = null;
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
    converted = out.files; slug = out.krpj.cfg_db_relay.slug || 'game';
    const k = out.krpj;
    log(`converted "${k.cfg_db_relay.title}" in ${Math.round(performance.now() - t0)} ms`);
    log(`  ${Object.keys(k.objects ?? {}).length} objects, ${Object.keys(k.rooms ?? {}).length} rooms, ${Object.keys(k.functions ?? {}).length} functions, ${Object.keys(k.sprites).length} sprites, ${Object.keys(k.sounds).length} sounds, ${Object.keys(k.included_files ?? {}).length} included files, ${converted.size} files`);
    if (!playerUrl) log('(no gm2kr-player-url configured: Play is disabled)');
    await pack();
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
