// gm2kr page: pick a GameMaker game folder, convert its data.win, then download the project
// as a .krpj or hand it straight to krplayer (see krplayer/src/loader/handoff.ts).
// The player URL comes from <meta name="gm2kr-player-url" content="...">, never hardcoded.
// Converting and zipping run in a worker (src/worker.ts) so the page stays responsive; .ogg compression stays
// here because it needs WebAudio (OfflineAudioContext), which workers don't have. It awaits the browser per file.

import { compressOggs } from './emit/ogg.ts';
import { canEncodeOpus, toOpus } from './opus_web.ts';
import { sendToPlayer } from '../../krplayer/src/loader/handoff.ts';
import type { FromWorker, Summary, ToWorker } from './worker.ts';

export function startPage() {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const input = $<HTMLInputElement>('input'), playBtn = $<HTMLButtonElement>('play'), dlBtn = $<HTMLButtonElement>('download');
  const oggBox = $<HTMLInputElement>('ogg'), kbpsBox = $<HTMLInputElement>('kbps');
  const statusText = $('status'), bar = $<HTMLProgressElement>('bar');
  const log = (msg: string) => { $('log').textContent += msg + '\n'; };
  const playerUrl = document.querySelector('meta[name="gm2kr-player-url"]')?.getAttribute('content') ?? '';
  const scriptUrl = (document.currentScript as HTMLScriptElement).src;

  /** Shows the current step on the status line (`total` 0: no step running). */
  const progress = (step: string, done = 0, total = 0) => {
    statusText.textContent = total > 1 ? `${step}… ${done}/${total}` : step && `${step}…`;
    bar.hidden = !step;
    if (total > 1) bar.value = done / total; else bar.removeAttribute('value'); // no value: indeterminate
  };

  // The worker is this same script. A script on another origin (a CDN) can't be a worker directly, but can be imported by one.
  let worker: Worker | null = null;
  const getWorker = () => {
    if (worker) return worker;
    try { worker = new Worker(scriptUrl); } catch {
      worker = new Worker(URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(scriptUrl)})`], { type: 'text/javascript' })));
    }
    return worker;
  };
  /** Sends one request to the worker, relaying its log and progress until it's done. */
  const ask = (req: ToWorker, transfer: Transferable[] = []) => new Promise<Extract<FromWorker, { type: 'done' }>>((resolve, reject) => {
    const w = getWorker();
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'log') log(m.msg);
      else if (m.type === 'progress') progress(m.step, m.done, m.total);
      else if (m.type === 'error') reject(new Error(m.message));
      else resolve(m);
    };
    w.onerror = (e) => { e.preventDefault(); worker?.terminate(); worker = null; reject(new Error(e.message || 'the conversion worker failed to start')); };
    w.postMessage(req, transfer);
  });

  /** `converted` is gm2kr's output as is; `files` is what the buttons use (the same, or with .ogg's compressed). */
  let converted: Map<string, Uint8Array> | null = null, files: Map<string, Uint8Array> | null = null, slug = 'game';
  const controls = [input, oggBox, kbpsBox, dlBtn, playBtn];
  /** Runs `task` with the controls off, so the buttons never see a half-done set. */
  async function busy(task: () => Promise<void>) {
    for (const c of controls) c.disabled = true;
    try { await task(); } catch (e) { log(`error: ${(e as Error).message}`); }
    progress('');
    input.disabled = false;
    oggBox.disabled = kbpsBox.disabled = !canEncodeOpus();
    dlBtn.disabled = !files;
    playBtn.disabled = !files || !playerUrl;
  }

  oggBox.disabled = kbpsBox.disabled = !canEncodeOpus();
  if (oggBox.disabled) oggBox.parentElement!.title = 'This browser has no Opus encoder (WebCodecs AudioEncoder)';

  /** Applies the .ogg option to the converted project. */
  async function pack() {
    if (!converted) return;
    files = converted;
    const kbps = Math.min(256, Math.max(16, +kbpsBox.value || 64));
    if (oggBox.checked) files = await compressOggs(converted, (d) => toOpus(d, kbps), log, progress);
  }
  const repack = () => busy(async () => { files = null; await pack(); });
  oggBox.addEventListener('change', repack);
  kbpsBox.addEventListener('change', () => { if (oggBox.checked) repack(); });

  input.addEventListener('change', () => busy(async () => {
    $('log').textContent = '';
    converted = files = null;
    const picked = [...(input.files ?? [])];
    const dataWin = picked.find((f) => f.name.toLowerCase() === 'data.win');
    if (!dataWin) return log('error: no data.win found in selection');
    // Everything else in the folder, by path relative to data.win (audio groups, external sounds, included files).
    const root = dataWin.webkitRelativePath.slice(0, dataWin.webkitRelativePath.length - dataWin.name.length);
    const extra = picked.filter((f) => f !== dataWin && f.webkitRelativePath.startsWith(root)).map((f): [string, File] => [f.webkitRelativePath.slice(root.length), f]);
    progress('Starting');
    const out = await ask({ type: 'convert', dataWin, extra });
    const s = out.summary as Summary;
    slug = s.slug;
    log(`  ${s.counts}`);
    if (!playerUrl) log('(no gm2kr-player-url configured: Play is disabled)');
    converted = new Map(out.files);
    await pack();
  }));

  dlBtn.addEventListener('click', () => busy(async () => {
    if (!files) return;
    progress('Zipping');
    const { zipped } = await ask({ type: 'zip', files: [...files] }); // copied, so `files` stays usable
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([zipped as BlobPart], { type: 'application/zip' })),
      download: `${slug}.krpj`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }));

  playBtn.addEventListener('click', () => {
    if (!files) return;
    try { sendToPlayer(playerUrl, files); } catch (e) { log(`error: ${(e as Error).message}`); }
  });
}
