// Browser entry (kressel.js). Picks a project source, then runs it on a canvas:
//   1. ?from=opener                       -> receive a project from the opening window (gm2kr "Play")
//   2. <meta id="kressel-load-project" src> -> load that game.json (assets next to it, or the CDN) or .krpj
//   3. otherwise                          -> let the user open a .krpj project
// Shared assets base: <meta name="kressel-shared-assets" content="/kr/sa/">.
// Embedding (kreditor's stage): <meta name="kressel-query" content="debug&room=x"> replaces location.search,
// and <meta name="kressel-autostart"> skips the click-to-start prompt (the host page already had a gesture).
// Debug (all need ?debug): ?room=<name|index> sends the game's first room change to that room (the init room still runs);
// add &direct to skip the init room entirely. ?set=name=v,name[i]=v and ?call=fn,fn(a,b) run (in URL order)
// just before the warp room is entered. ?debug also exposes the Game as `kr` in the console.

import { warpSetup } from './runtime/debug.ts';
import { fromFiles, fromKrpj, fromUrl, type ProjectSource } from './loader/source.ts';
import { receiveFromOpener } from './loader/handoff.ts';
import { createWebPlatform } from './platform/web.ts';
import { prepare } from './play.ts';

/** The page provides the shell (see index.html): .kr-root containing a <canvas> and a .kr-msg. Styling is up to the page. */
function shell() {
  const root = document.querySelector<HTMLElement>('.kr-root');
  const canvas = root?.querySelector('canvas');
  const msg = root?.querySelector<HTMLElement>('.kr-msg');
  if (!root || !canvas || !msg) throw new Error('kressel: page needs a .kr-root element containing a <canvas> and a .kr-msg');
  return {
    root, canvas,
    say(text: string, error = false) { msg.textContent = text; msg.classList.toggle('kr-err', error); msg.hidden = !text; },
  };
}
type Shell = ReturnType<typeof shell>;

/** Lets the user pick or drop a .krpj project. */
function pickKrpj(ui: Shell): Promise<ProjectSource> {
  return new Promise((resolve, reject) => {
    ui.say('');
    const box = document.createElement('label');
    box.className = 'kr-msg kr-drop';
    box.textContent = 'Drop a Kratience project (.krpj) here, or click to choose one';
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.krpj', hidden: true });
    box.append(input);
    ui.root.append(box);
    const take = (f: File | undefined) => {
      if (!f) return;
      box.remove();
      f.arrayBuffer().then((b) => fromKrpj(new Uint8Array(b))).then(resolve, reject);
    };
    input.addEventListener('change', () => take(input.files?.[0]));
    ui.root.addEventListener('dragover', (e) => e.preventDefault());
    ui.root.addEventListener('drop', (e) => { e.preventDefault(); take(e.dataTransfer?.files[0]); });
  });
}

const meta = (name: string) => document.querySelector(`meta[name="${name}"]`);
/** URL params, or the embedding page's kressel-query meta (srcdoc frames have no query string). */
const params = () => new URLSearchParams(meta('kressel-query')?.getAttribute('content') ?? location.search);

/** Browsers only allow audio after a user gesture, so the game starts on the first click or key. */
function gesture(ui: Shell): Promise<void> {
  ui.say('Click or press any key to start');
  return new Promise((resolve) => {
    const go = () => { removeEventListener('keydown', go); removeEventListener('pointerdown', go); ui.say(''); resolve(); };
    addEventListener('keydown', go); addEventListener('pointerdown', go);
  });
}

async function run(source: ProjectSource, ui: Shell): Promise<void> {
  ui.say('loading…');
  const platform = createWebPlatform(ui.canvas);
  const game = await prepare(source, platform, (m) => ui.say(`loading… ${m}`));
  document.title = game.a.title;
  if (meta('kressel-autostart')) {
    ui.say('');
    const wake = () => { platform.audioContext.resume(); };
    wake(); // may stay suspended without activation; any click/key in the frame retries
    addEventListener('pointerdown', wake, { once: true }); addEventListener('keydown', wake, { once: true });
  } else {
    await gesture(ui);
    await platform.audioContext.resume();
  }
  const fit = () => {
    const s = Math.min(ui.root.clientWidth / ui.canvas.width, ui.root.clientHeight / ui.canvas.height);
    ui.canvas.style.width = `${Math.floor(ui.canvas.width * s)}px`;
    ui.canvas.style.height = `${Math.floor(ui.canvas.height * s)}px`;
  };
  new ResizeObserver(fit).observe(ui.root); // .kr-root's size is set by the page, not just the window
  const fail = (e: unknown) => { ui.say(`Game error:
${(e as Error).message}`, true); console.error(e); };
  try {
    const q = params(), debug = q.has('debug');
    if (!debug && ['room', 'direct', 'set', 'call'].some((k) => q.has(k))) console.warn('kressel: ?room/direct/set/call are ignored without ?debug');
    const want = debug ? q.get('room') : null, warp = want ? game.findRoom(want) : -1;
    if (want && warp < 0) throw new Error(`?room=${want}: no such room`);
    const init = debug ? warpSetup(game, q) : null;
    if (init && warp < 0) throw new Error('?set= / ?call= need ?room=');
    if (debug) (globalThis as { kr?: unknown }).kr = game; // console access: kr.room.name, kr.roomIndex
    game.start(warp, debug && q.has('direct'), init);
  } catch (e) { return fail(e); }
  let acc = 0, last = performance.now(), w = 0, h = 0;
  const tick = (now: number) => {
    const stepMs = 1000 / game.speed;
    acc += Math.min(now - last, 250);
    last = now;
    try {
      for (let n = 0; acc >= stepMs; n++) {
        if (n === 4) { acc = 0; break; } // too far behind: drop time rather than spiral
        game.frame();
        acc -= stepMs;
        if (game.ended) break;
      }
    } catch (e) { return fail(e); }
    if (ui.canvas.width !== w || ui.canvas.height !== h) { w = ui.canvas.width; h = ui.canvas.height; fit(); }
    if (game.ended) { ui.say(game.endMessage || 'Game ended.'); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function boot() {
  const ui = shell();
  const src = document.getElementById('kressel-load-project')?.getAttribute('src');
  const shared = document.querySelector('meta[name="kressel-shared-assets"]')?.getAttribute('content') ?? undefined;
  try {
    let source: ProjectSource;
    if (params().get('from') === 'opener' && window.opener) {
      ui.say('waiting for the project…');
      source = fromFiles(await receiveFromOpener(), shared);
    } else if (src) {
      source = await fromUrl(src, { sharedAssetBase: shared });
    } else {
      source = await pickKrpj(ui);
    }
    await run(source, ui);
  } catch (e) {
    ui.say(`Couldn't start the game:\n${(e as Error).message}`, true);
    console.error(e);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
