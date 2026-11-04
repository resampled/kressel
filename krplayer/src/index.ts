// Browser entry (kressel.js). Picks a project source, then runs it on a canvas:
//   1. ?from=opener                       -> receive a project from the opening window (gm2kr "Play")
//   2. <meta id="kressel-load-project" src> -> load that game.json (assets next to it, or the CDN) or .krpj
//   3. otherwise                          -> let the user open a .krpj project
// Shared assets base: <meta name="kressel-shared-assets" content="/kr/sa/">.

import { fromFiles, fromKrpj, fromUrl, type ProjectSource } from './loader/source.ts';
import { receiveFromOpener } from './loader/handoff.ts';
import { createWebPlatform } from './platform/web.ts';
import { load } from './play.ts';

const STYLE = `
.kr-root { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #000; color: #ddd; font: 14px system-ui, sans-serif; }
.kr-root canvas { display: block; image-rendering: pixelated; }
.kr-msg { position: absolute; max-width: 640px; padding: 16px; text-align: center; white-space: pre-wrap; }
.kr-err { color: #f66; text-align: left; font-family: ui-monospace, monospace; }
.kr-drop { border: 2px dashed #555; border-radius: 8px; padding: 32px; }`;

function shell() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  const root = document.createElement('div');
  root.className = 'kr-root';
  const canvas = document.createElement('canvas');
  const msg = document.createElement('div');
  msg.className = 'kr-msg';
  root.append(canvas, msg);
  document.head.append(style);
  document.body.append(root);
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

async function run(source: ProjectSource, ui: Shell): Promise<void> {
  ui.say('loading…');
  const game = await load(source, createWebPlatform(ui.canvas));
  ui.say('');
  document.title = game.a.title;
  const fit = () => {
    const s = Math.min(innerWidth / ui.canvas.width, innerHeight / ui.canvas.height);
    ui.canvas.style.width = `${Math.floor(ui.canvas.width * s)}px`;
    ui.canvas.style.height = `${Math.floor(ui.canvas.height * s)}px`;
  };
  addEventListener('resize', fit);
  const stepMs = 1000 / game.a.fps;
  let acc = stepMs, last = performance.now(), w = 0, h = 0;
  const tick = (now: number) => {
    acc += Math.min(now - last, 250);
    last = now;
    try {
      for (let n = 0; acc >= stepMs; n++) {
        if (n === 4) { acc = 0; break; } // too far behind: drop time rather than spiral
        game.frame();
        acc -= stepMs;
      }
    } catch (e) {
      ui.say(`Game error:\n${(e as Error).message}`, true);
      console.error(e);
      return;
    }
    if (ui.canvas.width !== w || ui.canvas.height !== h) { w = ui.canvas.width; h = ui.canvas.height; fit(); }
    if (game.ended) { ui.say('Game ended.'); return; }
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
    if (new URLSearchParams(location.search).get('from') === 'opener' && window.opener) {
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
