// kreditor app shell: project tree, views, inspector, file menu, undo and the krplayer stage.
import { newProject, parseProject, serializeProject } from './project.js';
import { readKrpj, writeKrpj } from './krpj.js';
import { app, el, commit, doUndo, doRedo, resetHistory, KINDS, kindOf, coll, freeKey, allKeys,
  num, text, check, select, fields, section } from './state.js';
import { canvas, palette, palDown, palOpts, CATS } from './blocks.js';
import { roomView, roomInspector } from './room.js';
import { VIEWS, INSPECTORS, importFrames, importSound, importTileset, buildFont } from './assets.js';

const $ = (id) => document.getElementById(id);
const P = () => app.project;
const ui = { roomTab: 'layout', collapsed: new Set(), filter: '' };

// ── references between assets (rename / delete) ──
const REF_HEADS = new Set(['_as', '_fn', 'fnc_g', 'fnc_new']);
const REF_FIELDS = new Set(['sprite', 'parent', 'mask', 'object', 'tileset', 'follow', 'init_room']);
/** Visits every reference to `key` in the project; fix(container, index) may rewrite it. Returns the count. */
function refs(key, fix) {
  let n = 0;
  const hit = (o, k) => { n++; fix?.(o, k); };
  const walk = (v, parentKey) => {
    if (Array.isArray(v)) {
      if (REF_HEADS.has(v[0]) && v[1] === key) hit(v, 1);
      if (parentKey === 'tiles' && v.length === 10 && v[2] === key) hit(v, 2); // GMS1 tile: [x, y, sprite, ...]
      v.forEach((x, i) => (typeof x === 'string' ? (['room_order', 'preload', 'scripts'].includes(parentKey) && x === key && hit(v, i)) : walk(x, parentKey === 'tiles' ? 'tile' : '')));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === 'string') { if (REF_FIELDS.has(k) && x === key) hit(v, k); } else walk(x, k);
      }
    }
  };
  for (const [k, v] of Object.entries(P())) walk(v, k);
  return n;
}

function rename(view, from) {
  const [field] = kindOf(view);
  const to = prompt('New name (letters, digits and _)', from)?.trim();
  if (!to || to === from) return;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(to)) return alert('Names can only use letters, digits and _, and can\'t start with a digit.');
  if (allKeys().includes(to)) return alert(`There's already an asset called ${to}.`);
  P()[field] = Object.fromEntries(Object.entries(P()[field]).map(([k, v]) => [k === from ? to : k, v]));
  if ('name' in P()[field][to]) P()[field][to].name = to;
  refs(from, (o, k) => { o[k] = to; });
  app.sel.key = to;
  commit();
}
app.removeAsset = (key) => {
  const view = app.sel.view, [field] = kindOf(view), used = refs(key);
  if (!confirm(used ? `${key} is used ${used} time(s). Delete it anyway? (The game won't run until those uses are removed.)` : `Delete ${key}?`)) return;
  const a = P()[field][key];
  for (const p of [...(a.frames ?? []), a.src, a.atlas, a.image]) if (p?.startsWith('./')) app.assets.delete(p.slice(2));
  delete P()[field][key];
  if (P().cfg_project.init_room === key) P().cfg_project.init_room = Object.keys(P().rooms ?? {})[0] ?? null;
  if (P().room_order) P().room_order = P().room_order.filter((r) => r !== key);
  app.sel = { view: 'project', key: null };
  commit();
};

// ── creating assets ──
const MAKE = {
  functions: () => ({ args: [], body: [] }),
  objects: () => ({ sprite: null, parent: null, visible: true, persistent: false, scripts: [] }),
  rooms: () => ({ width: 640, height: 480, colour: 0, layers: [
    { name: 'Instances', type: 'instances', depth: 0, instances: [] },
    { name: 'Background', type: 'background', depth: 100, color: 0, sprite: null }], scripts: [] }),
  sprites: (name) => ({ name, frames: [], origin: [0, 0], speed: 15 }),
  sounds: (name) => ({ name, src: '', volume: 1, stream: false }),
  fonts: (name) => ({ name, atlas: '', font_name: 'Arial', size: 16, bold: false, italic: false, antialias: 1, line_height: 0, ranges: [[32, 127]], glyphs: {} }),
  tilesets: (name) => ({ name, image: '', tile_w: 16, tile_h: 16, border_x: 0, border_y: 0, columns: 1 }),
};
async function create(view) {
  const [field, , label, prefix] = kindOf(view);
  const key = prompt(`Name for the new ${label.toLowerCase().replace(/s$/, '')}`, freeKey(prefix))?.trim();
  if (!key) return;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || allKeys().includes(key)) return alert(`“${key}” is not a valid, unused name.`);
  coll(field)[key] = MAKE[field](key);
  if (field === 'rooms') {
    if (!P().cfg_project.init_room) P().cfg_project.init_room = key;
    P().room_order?.push(key);
  }
  if (field === 'fonts') await buildFont(key);
  app.sel = { view, key };
  commit();
  ({ sprite: importFrames, sound: importSound, tileset: importTileset })[view]?.(key);
}

// ── tree ──
const KCOL = { functions: 'fnc', objects: 'ins', rooms: 'rom', sprites: 'lks', sounds: 'snd', fonts: 'drw', tilesets: 'dat' };
function tree() {
  const body = $('tree-body'), scroll = body.scrollTop, f = ui.filter.toLowerCase();
  const item = (view, key, label, k, extra) => el('button.ti', { style: { '--k': `var(--${k})` }, 'aria-current': app.sel.view === view && app.sel.key === key ? 'true' : null,
    onclick: () => go(view, key) }, label, extra);
  const group = (id, title, count, addView, kids, empty) => {
    const d = el('details', { open: !ui.collapsed.has(id), ontoggle: () => (d.open ? ui.collapsed.delete(id) : ui.collapsed.add(id)) },
      el('summary', {}, title, el('b', {}, String(count)), addView && el('button.add', { textContent: '+', title: `New`, onclick: (e) => { e.preventDefault(); create(addView); } })),
      kids.length ? kids : empty && el('p.empty', {}, empty));
    return d;
  };
  const init = P().cfg_project.init_room;
  body.replaceChildren(
    el('button.ti.ti-project', { 'aria-current': app.sel.view === 'project' ? 'true' : null, onclick: () => go('project') }, P().cfg_db_relay.title || 'Untitled'),
    group('whole', 'Whole game', 2, null, [item('global', null, 'Game start scripts', 'evt'), item('files', null, 'Included files', 'dat', el('small', {}, String(Object.keys(P().included_files ?? {}).length)))]),
    ...KINDS.map(([field, view, label]) => {
      const keys = Object.keys(P()[field] ?? {});
      const shown = (f ? keys.filter((k) => k.toLowerCase().includes(f)) : keys).slice(0, 2000);
      return group(field, label, keys.length, view, shown.map((k) => item(view, k, k, KCOL[field], field === 'rooms' && k === init && el('span.tag.tag-start', {}, 'start'))),
        !f && { functions: 'Reusable scripts any object can call.', objects: 'Things with scripts, like a player or an enemy.', rooms: 'Add a room to give the game somewhere to start.' }[field]);
    }));
  body.scrollTop = scroll;
}
function go(view, key = null) { app.sel = { view, key }; app.render(); }

// ── views ──
const crumb = (group, name, small) => el('div.crumb', {}, group && el('span', {}, group), name, small && el('small', {}, small));
const vh = (...kids) => el('div.vh', {}, ...kids);
function projectView() {
  const p = P(), d = p.cfg_defaults, rooms = Object.keys(p.rooms ?? {});
  const size = (k) => el('input', { type: 'text', value: d[k], placeholder: 'default', onchange: (e) => { const v = e.target.value.trim(); d[k] = /^\d+$/.test(v) ? Number(v) : 'default'; commit(); } });
  const order = p.room_order ?? rooms;
  const move = (i, by) => { const o = [...order]; [o[i], o[i + by]] = [o[i + by], o[i]]; p.room_order = o; commit(); };
  const imp = p.cfg_gm_compat.imported_from;
  return [vh(crumb(null, 'Game settings')), el('div.pane', {}, el('div.form', {},
    el('div', {}, el('h3', {}, 'Game'), fields(['Title', el('input', { type: 'text', value: p.cfg_db_relay.title, onchange: (e) => { p.cfg_db_relay.title = e.target.value; commit(); } })],
      ['Start room', select(p.cfg_project, 'init_room', rooms.map((r) => [r]), 'First room in the order')])),
    el('div', {}, el('h3', {}, 'Window'), el('p', {}, 'Starting values. Scripts can change them while the game runs. “default” is the start room\'s size.'),
      fields(['Size', el('div.two', {}, size('width'), size('height'))], ['Frame rate', num(d, 'fps', 60)], ['Window title', text(d, 'window_title', 'Same as title')])),
    el('div', {}, el('h3', {}, 'Room order'), el('p', {}, '“Go to next room” follows this order.'),
      order.length ? el('ol.order', {}, order.map((r, i) => el('li', {}, el('span', { style: { flex: 1 } }, r),
        el('button', { textContent: '↑', disabled: i === 0, onclick: () => move(i, -1) }), el('button', { textContent: '↓', disabled: i === order.length - 1, onclick: () => move(i, 1) }))))
        : el('p.empty', {}, 'No rooms yet.')),
    el('div', {}, el('h3', {}, 'Imported from'), el('p', {}, imp ? `${imp.game} (GameMaker ${imp.gm_version?.join('.')}, bytecode ${imp.bytecode}), via ${imp.tool}` : 'Made in kreditor.')))) ];
}
function codeView(id, group, name, info, extra) {
  const cv = canvas(id, info);
  cv.classList.add('pane', 'code');
  return [vh(crumb(group, name)), ...(extra ? [extra] : []), cv];
}
function view() {
  const { view: v, key } = app.sel, p = P();
  switch (v) {
    case 'global': return codeView('global', 'Whole game', 'Game start scripts', 'Runs once, in order, before the first room, as the game itself: variables set here are global.');
    case 'function': {
      const fn = p.functions[key];
      const sig = el('div.sig', {}, 'Inputs', el('input', { type: 'text', value: fn.args.join(', '), placeholder: 'none, e.g. amount, target', style: { width: '18em' },
        onchange: (e) => { fn.args = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); commit(); } }),
      el('label.check', { style: { marginLeft: 'auto' } }, el('input', { type: 'checkbox', checked: !!fn.ctor, onchange: (e) => { fn.ctor = e.target.checked || undefined; commit(); } }), ' Constructor (use with “new”)'));
      return codeView('fn:' + key, 'Functions', key, 'Inputs are local variables inside the function.', sig);
    }
    case 'object': {
      const o = p.objects[key];
      return codeView('obj:' + key, 'Objects', key, `${o.parent ? `Inherits events from ${o.parent}.` : 'Inherits from nothing.'} Right-click for more.`);
    }
    case 'room': {
      const tabs = el('div.tabs', {}, [['layout', 'Layout'], ['code', 'Creation code']].map(([t, l]) =>
        el('button', { textContent: l, 'aria-selected': String(ui.roomTab === t), onclick: () => { ui.roomTab = t; app.render(); } })));
      if (ui.roomTab === 'code') {
        const cv = canvas('room:' + key, 'Runs once, after every instance in this room has run its create event.');
        cv.classList.add('pane', 'code');
        return [vh(crumb('Rooms', key), tabs), cv];
      }
      return [vh(crumb('Rooms', key), tabs), roomView(key)];
    }
    default:
      if (VIEWS[v] && (v === 'files' || p[kindOf(v)?.[0]]?.[key])) return [vh(crumb(v === 'files' ? null : kindOf(v)[2], v === 'files' ? 'Included files' : key)), VIEWS[v](key)];
      app.sel = { view: 'project', key: null };
      return projectView();
  }
}
function inspector() {
  const { view: v, key } = app.sel, p = P(), out = [];
  if (v === 'project') {
    const r = p.cfg_db_relay, ro = (val) => el('input', { type: 'text', value: val ?? '', disabled: true });
    out.push(section('Publishing', fields(['Link name', ro(r.slug)], ['Author', ro(r.author)], ['Revision', ro(r.revision)],
      ['Created', ro(r.date_created ? new Date(r.date_created * 1000).toLocaleDateString() : '')]), el('small', {}, 'Filled in by the site when you publish.')));
  }
  if (kindOf(v) && key) out.push(section('Asset', fields(['Name', el('div.two', {}, el('code', {}, key), el('button.btn', { textContent: 'Rename', onclick: () => rename(v, key) }))]),
    ['object', 'room', 'function'].includes(v) && el('button.btn', { textContent: 'Delete', style: { marginTop: '8px' }, onclick: () => app.removeAsset(key) })));
  if (v === 'object') {
    const o = p.objects[key], objs = Object.keys(p.objects).filter((k) => k !== key).map((k) => [k]), sprs = Object.keys(p.sprites).map((k) => [k]);
    out.push(section('Object', fields(['Sprite', select(o, 'sprite', sprs, 'None')], ['Collision mask', select(o, 'mask', sprs, 'Same as sprite')],
      ['Parent', select(o, 'parent', objs, 'None')], ['Depth', num(o, 'depth')], ['', check(o, 'visible', 'Visible', true)], ['', check(o, 'solid', 'Solid')],
      ['', check(o, 'persistent', 'Persistent')])));
    const placed = Object.entries(p.rooms ?? {}).map(([r, room]) => [r, room.layers.reduce((n, l) => n + (l.instances?.filter((i) => i.object === key).length ?? 0), 0)]).filter(([, n]) => n);
    out.push(section('Placed in', placed.length ? el('div.chips', {}, placed.map(([r, n]) => el('button', { textContent: `${r} ×${n}`, onclick: () => go('room', r) }))) : el('small', {}, 'Not placed in any room yet.')));
  }
  if (v === 'room') out.push(...roomInspector(key));
  if (INSPECTORS[v] && key) out.push(...INSPECTORS[v](key));
  if (v === 'function') out.push(section('Used by', el('small', {}, `Called in ${refs(key)} place(s).`)));
  return out;
}

// ── palette ──
let palSig = '';
function syncPalette(coding) {
  $('work').classList.toggle('coding', coding);
  if (!coding) return;
  const sig = [app.sel.view, palOpts.advanced, palOpts.compat, palOpts.filter, Object.keys(P().functions ?? {}).join(), allKeys().slice(0, 3).join()].join('|');
  if (sig === palSig) return;
  palSig = sig;
  $('pal-blocks').replaceChildren(...palette(app.sel.view).childNodes);
}

// ── render ──
function render() {
  const title = P().cfg_db_relay.title || 'Untitled';
  document.title = `${app.dirty ? '• ' : ''}Editing ${title}`;
  $('hd-title').textContent = title; $('idle-title').textContent = title;
  tree();
  const old = document.querySelector('#view .pane'), keep = old && $('view').dataset.at === JSON.stringify(app.sel) + ui.roomTab ? [old.scrollLeft, old.scrollTop] : null;
  const v = el('section.view', {}, view());
  $('view').replaceChildren(v);
  $('view').dataset.at = JSON.stringify(app.sel) + ui.roomTab;
  const cv = v.querySelector('.cv');
  cv?.layout();
  const pane = v.querySelector('.pane');
  if (keep && pane) [pane.scrollLeft, pane.scrollTop] = keep;
  syncPalette(!!cv);
  const ins = $('insp');
  const s = ins.scrollTop;
  ins.replaceChildren(el('div.insp-h', {}, 'Properties'), ...inspector());
  ins.scrollTop = s;
  const rooms = Object.keys(P().rooms ?? {}), start = P().cfg_project.init_room ?? (P().room_order ?? rooms)[0];
  $('st-problems').textContent = rooms.length ? 'Ready to play' : 'Add a room to play';
  $('st-problems').className = rooms.length ? 'ok' : 'warn';
  $('st-saved').textContent = app.dirty ? 'Unsaved changes' : 'No unsaved changes';
  $('st-start').textContent = `Start room: ${start ?? 'none'}`;
  $('st-ver').textContent = `krpj ${P().krpj_v}`;
}
app.render = render;

// ── files ──
function load(project, assets) {
  stop();
  app.project = project; app.assets = assets; app.sel = { view: 'project', key: null };
  resetHistory(); palSig = '';
  render();
}
const confirmDiscard = () => !app.dirty || confirm('Discard unsaved changes?');
async function openFile(f) {
  if (!f || !confirmDiscard()) return;
  try {
    if (f.name.toLowerCase().endsWith('.json')) return load(parseProject(await f.text()), new Map());
    const files = await readKrpj(new Uint8Array(await f.arrayBuffer()));
    const main = files.get('game.json');
    if (!main) throw new Error('no game.json in this .krpj');
    files.delete('game.json');
    load(parseProject(new TextDecoder().decode(main)), files);
  } catch (e) { alert(`Couldn't open ${f.name}: ${e.message}`); }
}
const projectFiles = () => new Map([['game.json', new TextEncoder().encode(serializeProject(P()))], ...app.assets]);
function save() {
  const a = el('a', { href: URL.createObjectURL(writeKrpj(projectFiles())), download: `${P().cfg_db_relay.slug || P().cfg_db_relay.title.replace(/[^\w-]+/g, '_') || 'game'}.krpj` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  app.dirty = false;
  render();
}
const ACTIONS = {
  'btn-new': () => confirmDiscard() && load(newProject(), new Map()),
  'btn-open': () => { const i = el('input', { type: 'file', accept: '.krpj,.json' }); i.onchange = () => openFile(i.files[0]); i.click(); },
  'btn-save': save,
  'btn-undo': doUndo, 'btn-redo': doRedo,
  'btn-find': () => $('tree-find').focus(),
  'btn-settings': () => go('project'), 'btn-global': () => go('global'), 'btn-files': () => go('files'),
  'btn-play': () => play(false), 'btn-play-room': () => play(true), 'btn-stop': () => stop(),
};

// ── stage: the game runs in krplayer inside an iframe ──
let gameUrl = null;
function stop() {
  $('stage').querySelector('iframe')?.remove();
  if (gameUrl) URL.revokeObjectURL(gameUrl);
  gameUrl = null;
  document.body.classList.remove('running');
}
function play(fromHere) {
  stop();
  const rooms = Object.keys(P().rooms ?? {});
  if (!rooms.length) return alert('Add a room first: the game needs somewhere to start.');
  const room = fromHere ? (app.sel.view === 'room' ? app.sel.key : prompt('Start in which room?', rooms[0])) : null;
  if (fromHere && !rooms.includes(room)) return;
  gameUrl = URL.createObjectURL(writeKrpj(projectFiles()));
  const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const q = room ? `debug&room=${encodeURIComponent(room)}&direct` : '';
  const frame = el('iframe', { title: 'Game', allow: 'autoplay; fullscreen; gamepad', srcdoc: `<!doctype html><meta charset="utf-8">
<meta id="kressel-load-project" src="${attr(gameUrl)}"><meta name="kressel-shared-assets" content="${attr(app.config.sharedAssets)}">
<meta name="kressel-autostart"><meta name="kressel-query" content="${attr(q)}">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}.kr-root{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#ddd;font:13px system-ui,sans-serif}
.kr-root canvas{display:block;image-rendering:pixelated}.kr-msg{position:absolute;max-width:90%;padding:12px;text-align:center;white-space:pre-wrap}.kr-err{color:#f66;text-align:left;font:12px ui-monospace,monospace;overflow:auto;max-height:100%}</style>
<div class="kr-root"><canvas></canvas><div class="kr-msg" hidden></div></div>
<script src="${attr(new URL(app.config.player, location.href).href)}"><\/script>` });
  frame.onload = () => frame.contentWindow.focus();
  $('stage').append(frame);
  document.body.classList.add('running');
}

// ── wiring ──
document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  const menu = e.target.closest('.hdm');
  const opening = menu && e.target.classList.contains('hdmi') && !menu.classList.contains('open');
  document.querySelectorAll('.hdm.open').forEach((m) => m.classList.remove('open'));
  if (opening) menu.classList.add('open');
  if (!e.target.closest('#ctx')) $('ctx').hidden = true;
  if (act) ACTIONS[act.dataset.act]?.();
});
$('pal-rail').append(...CATS.map(([c, l]) => el('button', { style: { '--c': `var(--${c === 'ctr' ? 'ctl' : c})` }, textContent: l, onclick: () => $(`pc-${c}`)?.scrollIntoView({ block: 'start' }) })));
$('pal-blocks').addEventListener('pointerdown', palDown);
$('pal-find').oninput = (e) => { palOpts.filter = e.target.value; render(); };
$('pal-adv').onchange = (e) => { palOpts.advanced = e.target.checked; render(); };
$('pal-compat').onchange = (e) => { palOpts.compat = e.target.checked; render(); };
$('tree-find').oninput = (e) => { ui.filter = e.target.value; tree(); };
$('btn-full').onclick = () => $('stage').requestFullscreen?.();
addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') $('ctx').hidden = true;
  if (mod && k === 's') { e.preventDefault(); save(); }
  else if (mod && k === 'o') { e.preventDefault(); ACTIONS['btn-open'](); }
  else if (mod && !typing && (k === 'z' || k === 'y')) { e.preventDefault(); (k === 'y' || e.shiftKey ? doRedo : doUndo)(); }
  else if (e.key === 'F5') { e.preventDefault(); play(e.shiftKey); }
});
addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
addEventListener('drop', (e) => { const f = e.dataTransfer?.files[0]; if (f && /\.(krpj|json)$/i.test(f.name)) { e.preventDefault(); openFile(f); } });
addEventListener('beforeunload', (e) => { if (app.dirty) e.preventDefault(); });

const hash = location.hash.slice(1);
if (['project', 'global', 'files'].includes(hash)) app.sel = { view: hash, key: null };
resetHistory();
render();
