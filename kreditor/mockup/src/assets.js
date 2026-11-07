// Asset views: basic import/preview/delete for sprites, sounds, fonts, tile sets and included files.
import { app, el, commit, assetUrl, freePath, pickFiles, fileBytes, num, select, fields, section } from './state.js';

const pane = (...kids) => el('div.pane', {}, el('div.asset-stage', {}, ...kids));
const bar = (...kids) => el('div.asset-bar', {}, ...kids);
const btn = (label, onclick, cls = '') => el('button.btn' + cls, { textContent: label, onclick });
const delBtn = (key) => btn('Delete', () => app.removeAsset(key));

/** Image file -> PNG bytes (non-PNG images are re-encoded, since the player loads frames as PNG). */
async function png(file) {
  if (file.type === 'image/png') return fileBytes(file);
  const bmp = await createImageBitmap(file), c = el('canvas', { width: bmp.width, height: bmp.height });
  c.getContext('2d').drawImage(bmp, 0, 0);
  return new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer());
}
const store = (path, bytes) => { app.assets.set(path, bytes); return './' + path; };
const unstore = (p) => { if (p?.startsWith('./')) app.assets.delete(p.slice(2)); };
const imgSize = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res([0, 0]); i.src = src; });

// ── sprites ──
export async function importFrames(key) {
  const spr = app.project.sprites[key], files = (await pickFiles('image/*', true)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!files.length) return false;
  for (const f of files) spr.frames.push(store(freePath(`sprites/${key}`, String(spr.frames.length), 'png'), await png(f)));
  commit();
  return true;
}
let frameSel = 0;
function spriteView(key) {
  const spr = app.project.sprites[key];
  frameSel = Math.min(frameSel, Math.max(0, spr.frames.length - 1));
  const big = el('img.preview', { src: assetUrl(spr.frames[frameSel]), title: 'Click to set the origin', draggable: false });
  const mark = el('div.origin');
  const holder = el('div.preview-box', {}, big, mark);
  const place = () => { const s = big.clientWidth / (big.naturalWidth || 1); Object.assign(mark.style, { left: `${spr.origin[0] * s}px`, top: `${spr.origin[1] * s}px` }); };
  big.onload = place;
  big.onclick = (e) => {
    const r = big.getBoundingClientRect(), s = (big.naturalWidth || 1) / r.width;
    spr.origin = [Math.round((e.clientX - r.left) * s), Math.round((e.clientY - r.top) * s)];
    commit();
  };
  return pane(
    bar(btn('Import frames…', () => importFrames(key)), delBtn(key)),
    spr.frames.length ? holder : el('div.drop', {}, 'No frames yet. Import PNG images (one per frame).'),
    el('div.frames', {}, spr.frames.map((f, i) => el('div.frame' + (i === frameSel ? '.on' : ''), { onclick: () => { frameSel = i; app.render(); } },
      el('img', { src: assetUrl(f), draggable: false }), el('small', {}, String(i)),
      el('button.x', { textContent: '×', title: 'Delete frame', onclick: (e) => { e.stopPropagation(); unstore(spr.frames.splice(i, 1)[0]); commit(); } })))));
}
/** An input that calls set(value) on change (numbers, text or checkbox). */
function input(type, value, set, label) {
  const i = el('input', { type, value: type === 'checkbox' ? undefined : value, checked: type === 'checkbox' && !!value,
    onchange: () => set(type === 'checkbox' ? i.checked : type === 'number' ? Number(i.value) : i.value) });
  return label ? el('label.check', {}, i, ` ${label}`) : i;
}
function spriteInspector(key) {
  const spr = app.project.sprites[key], o = spr.origin;
  return [section('Sprite', fields(
    ['Frames', el('small', {}, String(spr.frames.length))],
    ['Origin', el('div.two', {}, input('number', o[0], (v) => { spr.origin = [v, o[1]]; commit(); }), input('number', o[1], (v) => { spr.origin = [o[0], v]; commit(); }))],
    ['', btn('Center origin', async () => { const [w, h] = await imgSize(assetUrl(spr.frames[0])); spr.origin = [w >> 1, h >> 1]; commit(); })],
    ['Animation', el('div.two', {}, num(spr, 'speed', 15), select(spr, 'speed_type', [['fps', 'per second'], ['frame', 'per game frame']]))],
    ['Collision', select(spr, 'mask', [['rect', 'Box'], ['rotated', 'Rotated box'], ...(spr.mask_bits ? [['precise', 'Exact pixels']] : [])])]))];
}

// ── sounds ──
let playing = null;
export async function importSound(key) {
  const [f] = await pickFiles('audio/*,.ogg,.wav,.mp3');
  if (!f) return false;
  const snd = app.project.sounds[key], ext = (f.name.split('.').pop() || 'ogg').toLowerCase();
  unstore(snd.src);
  snd.src = store(freePath('sounds', key, ext), await fileBytes(f));
  commit();
  return true;
}
function soundView(key) {
  const snd = app.project.sounds[key];
  const stop = () => { playing?.pause(); playing = null; };
  return pane(
    el('div.sound-card', {}, el('div.font1', { style: { fontSize: '22px' } }, key), el('small', {}, snd.src ? snd.src.replace(/^\.\//, '') : 'No audio file')),
    bar(btn('Import…', () => importSound(key)),
      btn('▶ Play', () => { stop(); if (!snd.src) return; playing = new Audio(assetUrl(snd.src)); playing.volume = Math.min(1, snd.volume ?? 1); playing.play().catch((e) => alert(e.message)); }, ''),
      btn('■ Stop', stop), delBtn(key)));
}

// ── fonts ──
/** Renders font.font_name into an atlas + glyph table (white glyphs on transparent, like GameMaker's font pages). */
export async function buildFont(key) {
  const f = app.project.fonts[key];
  const fam = `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size}px "${f.font_name}", sans-serif`;
  try { await document.fonts.load(fam); } catch { /* system font or not loadable: canvas falls back */ }
  const c = el('canvas'), g = c.getContext('2d');
  g.font = fam;
  const m = g.measureText('Hgjy|'), asc = Math.ceil(m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent), lh = Math.ceil(asc + (m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent));
  const codes = f.ranges.flatMap(([a, b]) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i)).slice(0, 4096);
  const W = 512, glyphs = {};
  let x = 1, y = 1;
  for (const code of codes) {
    const w = Math.max(1, Math.ceil(g.measureText(String.fromCodePoint(code)).width));
    if (x + w + 1 > W) { x = 1; y += lh + 1; }
    glyphs[code] = [x, y, w, lh, Math.round(g.measureText(String.fromCodePoint(code)).width), 0];
    x += w + 2;
  }
  c.width = W; c.height = y + lh + 1;
  g.font = fam; g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
  for (const code of codes) g.fillText(String.fromCodePoint(code), glyphs[code][0], glyphs[code][1] + asc);
  if (!f.antialias) {
    const d = g.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] > 127 ? 255 : 0;
    g.putImageData(d, 0, 0);
  }
  const bytes = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer());
  const path = f.atlas?.startsWith('./fonts/') ? f.atlas.slice(2) : freePath('fonts', key, 'png');
  f.atlas = store(path, bytes);
  Object.assign(f, { glyphs, line_height: lh });
  delete f.kerning;
}
let sample = 'The quick brown fox jumps over the lazy dog.\n0123456789 !?';
function fontView(key) {
  const f = app.project.fonts[key], cv = el('canvas.font-sample');
  const img = new Image();
  const paint = () => {
    const lines = sample.split('\n'), shift = (ch) => f.glyphs[ch.codePointAt(0)]?.[4] ?? 0;
    cv.width = Math.max(64, ...lines.map((l) => [...l].reduce((n, ch) => n + shift(ch), 0))) + 16;
    cv.height = lines.length * f.line_height + 16;
    const g = cv.getContext('2d');
    if (!img.complete || !img.naturalWidth) return;
    lines.forEach((l, row) => {
      let x = 8;
      for (const ch of l) { const gl = f.glyphs[ch.codePointAt(0)]; if (gl) { g.drawImage(img, gl[0], gl[1], gl[2], gl[3], x + gl[5], 8 + row * f.line_height, gl[2], gl[3]); x += gl[4]; } }
    });
  };
  img.onload = paint; img.src = assetUrl(f.atlas);
  const ta = el('textarea.sample-text', { value: sample, rows: 3, oninput: () => { sample = ta.value; paint(); } });
  return pane(cv, ta, el('small', {}, 'Type above to preview other text.'), bar(delBtn(key)));
}
function fontInspector(key) {
  const f = app.project.fonts[key], r = [f.ranges[0]?.[0] ?? 32, f.ranges.at(-1)?.[1] ?? 127];
  const rebuild = async () => { f.ranges = [[r[0], r[1]]]; await buildFont(key); commit(); };
  const on = (k, map = (v) => v) => (v) => { f[k] = map(v); rebuild(); };
  return [section('Font', fields(
    ['Source font', input('text', f.font_name, on('font_name'))],
    ['Size', input('number', f.size, on('size'))],
    ['', input('checkbox', f.bold, on('bold'), 'Bold')], ['', input('checkbox', f.italic, on('italic'), 'Italic')],
    ['', input('checkbox', f.antialias, on('antialias', Number), 'Smooth edges')],
    ['Characters', el('div.two', {}, input('number', r[0], (v) => { r[0] = v; rebuild(); }), input('number', r[1], (v) => { r[1] = v; rebuild(); }))],
    ['Line height', el('small', {}, String(f.line_height))],
    ['', btn('Rebuild font', rebuild)]))];
}

// ── tile sets ──
export async function importTileset(key) {
  const [file] = await pickFiles('image/*');
  if (!file) return false;
  const ts = app.project.tilesets[key];
  unstore(ts.image);
  ts.image = store(freePath('tilesets', key, 'png'), await png(file));
  const [w] = await imgSize(assetUrl(ts.image));
  ts.columns = Math.max(1, Math.floor(w / (ts.tile_w + 2 * ts.border_x)));
  commit();
  return true;
}
function tilesetView(key) {
  const ts = app.project.tilesets[key];
  return pane(bar(btn('Import image…', () => importTileset(key)), delBtn(key)),
    ts.image ? el('img.preview', { src: assetUrl(ts.image), draggable: false }) : el('div.drop', {}, 'No image yet.'),
    el('small', {}, 'Tile 0 is always empty.'));
}
const tilesetInspector = (key) => {
  const ts = app.project.tilesets[key];
  return [section('Tile set', fields(['Tile size', el('div.two', {}, num(ts, 'tile_w', 16), num(ts, 'tile_h', 16))],
    ['Padding', el('div.two', {}, num(ts, 'border_x'), num(ts, 'border_y'))], ['Columns', num(ts, 'columns', 1)]))];
};

// ── included files ──
function filesView() {
  const inc = (app.project.included_files ??= {});
  const add = async () => {
    for (const f of await pickFiles('*/*', true)) inc[f.name] = store(freePath('files', f.name.replace(/\.[^.]*$/, ''), f.name.split('.').pop()), await fileBytes(f));
    commit();
  };
  const rows = Object.entries(inc).map(([name, path]) => el('tr', {},
    el('td', {}, el('input', { type: 'text', value: name, onchange: (e) => { const v = e.target.value.trim(); if (!v || v in inc) return app.render(); const o = Object.entries(inc).map(([k, p]) => [k === name ? v : k, p]); app.project.included_files = Object.fromEntries(o); commit(); } })),
    el('td', {}, el('code', {}, path)),
    el('td', {}, `${((app.assets.get(path.slice(2))?.length ?? 0) / 1024).toFixed(1)} KB`),
    el('td', {}, el('button.btn', { textContent: '×', title: 'Remove', onclick: () => { delete inc[name]; unstore(path); commit(); } }))));
  return el('div.pane', {}, el('div.form', {}, el('div', {},
    el('p', {}, 'Files the game can open by name (text, JSON, ini, music streams).'),
    bar(btn('Add files…', add)),
    el('table', {}, el('tr', {}, el('th', {}, 'Game opens it as'), el('th', {}, 'Stored at'), el('th', {}, 'Size'), el('th')),
      rows.length ? rows : el('tr', {}, el('td', { colSpan: 4 }, el('small', {}, 'No files yet.')))))));
}

export const VIEWS = { sprite: spriteView, sound: soundView, font: fontView, tileset: tilesetView, files: filesView };
export const INSPECTORS = { sprite: spriteInspector, font: fontInspector, tileset: tilesetInspector };
