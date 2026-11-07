// Editor state shared by every module: the open project, its asset files, selection, undo.
// Edits mutate app.project in place and then call commit(), which records undo and re-renders.
import { newProject } from './project.js';

const meta = (name, fallback) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || fallback;

export const app = {
  project: newProject(),
  /** Project files other than game.json, keyed without "./" ("sprites/x/0.png"). */
  assets: new Map(),
  /** Current view ("project", "global", "object", "room"...) and asset key. */
  sel: { view: 'project', key: null },
  dirty: false,
  config: {
    player: meta('kreditor-player', '../krplayer/dist/kressel.js'),
    sharedAssets: meta('kreditor-shared-assets', '/kr/sa/'),
  },
  /** Set by main.js: re-render tree, view and inspector. */
  render: () => {},
};

/** Asset kinds, in tree order: project field, view name, label, key prefix for new ones. */
export const KINDS = [
  ['functions', 'function', 'Functions', 'scr_'],
  ['objects', 'object', 'Objects', 'obj_'],
  ['rooms', 'room', 'Rooms', 'room_'],
  ['sprites', 'sprite', 'Sprites', 'spr_'],
  ['sounds', 'sound', 'Sounds', 'snd_'],
  ['fonts', 'font', 'Fonts', 'fnt_'],
  ['tilesets', 'tileset', 'Tile sets', 'ts_'],
];
export const kindOf = (view) => KINDS.find((k) => k[1] === view);
export const coll = (field) => (app.project[field] ??= {});

// ── undo ──
let undo = [], redo = [], last = '';
const snap = () => ({ json: last, assets: new Map(app.assets) });
export function resetHistory() { undo = []; redo = []; last = JSON.stringify(app.project); app.dirty = false; }
/** Call after mutating the project. */
export function commit() {
  undo.push(snap());
  if (undo.length > 60) undo.shift();
  redo = [];
  last = JSON.stringify(app.project);
  app.dirty = true;
  app.render();
}
function restore(from, to) {
  const s = from.pop();
  if (!s) return;
  to.push(snap());
  app.project = JSON.parse(s.json);
  app.assets = s.assets;
  last = s.json;
  app.dirty = true;
  app.render();
}
export const doUndo = () => restore(undo, redo);
export const doRedo = () => restore(redo, undo);

// ── asset URLs ──
const blobs = new Map();
/** game.json asset path ("./x" or "/sa/~a/x") -> displayable URL. */
export function assetUrl(path) {
  if (!path) return '';
  if (path.startsWith('/sa/')) return app.config.sharedAssets + path.slice(4);
  const key = path.replace(/^\.\//, ''), data = app.assets.get(key);
  if (!data) return '';
  let b = blobs.get(key);
  if (b?.data !== data) {
    if (b) URL.revokeObjectURL(b.url);
    b = { data, url: URL.createObjectURL(new Blob([data], { type: mime(key) })) };
    blobs.set(key, b);
  }
  return b.url;
}
export const mime = (p) => ({ png: 'image/png', ogg: 'audio/ogg', wav: 'audio/wav', mp3: 'audio/mpeg' })[p.split('.').pop().toLowerCase()] || 'application/octet-stream';

/** An unused file path "dir/name.ext" (numbered if taken). */
export function freePath(dir, name, ext) {
  for (let n = 0; ; n++) {
    const p = `${dir}/${name}${n ? '_' + n : ''}.${ext}`;
    if (!app.assets.has(p)) return p;
  }
}

/** Every asset key in the shared namespace. */
export const allKeys = () => KINDS.flatMap(([f]) => Object.keys(app.project[f] ?? {}));
export function freeKey(prefix) {
  const taken = new Set(allKeys());
  for (let n = 0; ; n++) if (!taken.has(prefix + n)) return prefix + n;
}

// ── DOM helper ──
/** el('div.cls', {props}, ...children). Props starting with "on" are listeners. */
export function el(sel, props = {}, ...kids) {
  const [tag, ...cls] = sel.split('.');
  const e = document.createElement(tag || 'div');
  if (cls.length) e.className = cls.join(' ');
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) p.startsWith('--') ? e.style.setProperty(p, x) : (e.style[p] = x);
    else if (k in e && k !== 'list') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

/** Picks files; resolves with File[] (empty if cancelled). */
export function pickFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, multiple });
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}
export const fileBytes = async (f) => new Uint8Array(await f.arrayBuffer());

// ── form controls bound to obj[key]; each change commits ──
const bind = (obj, key, parse) => (e) => { obj[key] = parse(e.target); commit(); };
export const num = (obj, key, def = 0) => el('input', { type: 'number', step: 'any', value: obj[key] ?? def, onchange: bind(obj, key, (t) => Number(t.value)) });
export const text = (obj, key, placeholder = '') => el('input', { type: 'text', value: obj[key] ?? '', placeholder, onchange: bind(obj, key, (t) => t.value) });
export const check = (obj, key, label, def = false) =>
  el('label.check', {}, el('input', { type: 'checkbox', checked: obj[key] ?? def, onchange: bind(obj, key, (t) => t.checked) }), ` ${label}`);
/** options: [value, label][]; with none set, '' means null. */
export function select(obj, key, options, none) {
  const s = el('select', { onchange: bind(obj, key, (t) => (t.value === '' && none ? null : t.value)) },
    none && el('option', { value: '', textContent: none }), options.map(([v, l]) => el('option', { value: v, textContent: l ?? v })));
  s.value = obj[key] ?? '';
  return s;
}
const bgr2hex = (c) => '#' + [c & 255, (c >> 8) & 255, (c >> 16) & 255].map((x) => x.toString(16).padStart(2, '0')).join('');
export const hexOf = bgr2hex;
export const colour = (obj, key, def = 0) => el('input', { type: 'color', value: bgr2hex(obj[key] ?? def),
  onchange: bind(obj, key, (t) => { const n = parseInt(t.value.slice(1), 16); return ((n & 255) << 16) | (n & 0xff00) | (n >> 16); }) });
/** [label, control] pairs -> the two-column field grid. */
export const fields = (...pairs) => el('div.fields', {}, pairs.flatMap(([l, c]) => [el('span', {}, l), c]));
export const section = (title, ...kids) => el('section.insp', {}, el('h3', {}, title), ...kids);
