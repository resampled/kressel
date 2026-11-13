// Editor UI around kreditorProject: the File menu, Undo/Redo, the asset dropdowns (nav2 [data-menu]) and the main window,
// which shows one asset at a time. VIEWS maps a game.json field to how it's edited:
//   label     dropdown / message name          single  the view edits the whole project (no key), e.g. Game
//   tabs      { name: draw(data, key) }: 'code' shows the block canvas, other tabs draw into the form pane
//   title     (key, data) -> window title      item    (key, data) -> dropdown label
//   create    () -> data for a new asset (the dropdown then offers "create <typed name>")
//   units     [[field, key?], ...] it edits, for undo (default: [[field, key]])
// A kind without tabs is listed but says it has no editor yet: adding an editor means adding its tabs here.
var kreditorViews = (function () {
  'use strict';
  const P = kreditorProject, C = kreditorCode, proj = P.proj;
  const win = document.querySelector('.w-code').closest('.w'), titleEl = win.querySelector('.wtitle'), tabsEl = win.querySelector('.wtabs');
  const codePane = win.querySelector('.w-code'), formPane = win.querySelector('.w-props');
  const g = () => proj.game, keys = (field) => Object.keys(g()[field] || {});
  function h(name, cls, ...kids) {
    const e = document.createElement(name);
    if (cls) e.className = cls;
    e.append(...kids);
    return e;
  }

  // ── form helpers: each edits obj[field] and calls done() (records the undo step) ──
  const F = {
    /** Dropdown of ks() (searchable); null = `none`. */
    pick(obj, field, ks, label, none, done) {
      const v = obj[field] ?? null, b = h('span', 'dd' + (v == null ? ' none' : ''), v == null ? none : label(v));
      b.onclick = () => C.popup(b, [[null, none], ...ks().map((k) => [k, label(k)])], v, (x) => { obj[field] = x; done(); redraw(); });
      return b;
    },
    check(obj, field, def, done) {
      const c = h('input'); c.type = 'checkbox'; c.checked = obj[field] ?? def;
      c.onchange = () => { obj[field] = c.checked; done(); };
      return c;
    },
    /** Number box; a blank box stores `blank` (undefined: removes the field). */
    num(obj, field, done, blank, placeholder = '') {
      const n = h('input'); n.type = 'number'; n.value = typeof obj[field] === 'number' ? obj[field] : ''; n.placeholder = placeholder;
      n.onchange = () => { if (n.value !== '') obj[field] = Number(n.value); else if (blank === undefined) delete obj[field]; else obj[field] = blank; done(); };
      return n;
    },
    text(obj, field, done) {
      const t = h('input'); t.value = obj[field] ?? ''; t.spellcheck = false;
      t.onchange = () => { obj[field] = t.value; done(); };
      return t;
    },
    /** Fills the form pane: a heading, then [label, input] rows ('' label: a full-width row). */
    form(heading, rows) {
      formPane.replaceChildren(h('h3', '', heading), ...rows.flatMap(([l, input]) => l ? [h('label', '', l), input] : [h('div', 'wide', input)]));
    },
  };
  const named = (k, d) => d && d.name && d.name !== k ? `${k} (${d.name})` : k;
  const sprLabel = (k) => named(k, (g().sprites || {})[k]);
  const edited = () => flush();

  // ── views ──
  const codeTab = (kind) => (d) => { if (C.current() !== d) { C.open(kind, d); C.commit(); } };
  function objectProps(o, key) {
    // parent: any object that doesn't already inherit from this one (no cycles)
    const inherits = (k) => { for (let i = 0; k && i < 1e4; i++, k = (g().objects[k] || {}).parent) if (k === key) return true; return false; };
    F.form(key, [['Sprite', F.pick(o, 'sprite', () => keys('sprites'), sprLabel, 'none', edited)],
      ['Collision mask', F.pick(o, 'mask', () => keys('sprites'), sprLabel, 'same as sprite', edited)],
      ['Parent', F.pick(o, 'parent', () => keys('objects').filter((k) => !inherits(k)), String, 'none', edited)],
      ['Depth', F.num(o, 'depth', edited, undefined, '0')], ['Visible', F.check(o, 'visible', true, edited)],
      ['Solid', F.check(o, 'solid', false, edited)], ['Persistent', F.check(o, 'persistent', false, edited)],
      ...(o.imported_from ? [['Imported from', h('span', '', o.imported_from)]] : [])]);
  }
  function gameProps(d) {
    const r = d.cfg_db_relay ||= {}, def = d.cfg_defaults ||= {}, pj = d.cfg_project ||= {}, gm = (d.cfg_gm_compat || {}).imported_from;
    F.form(r.title || 'Game', [['Title', F.text(r, 'title', edited)], ['Window title', F.text(def, 'window_title', edited)],
      ['Width', F.num(def, 'width', edited, 'default', 'first room\'s')], ['Height', F.num(def, 'height', edited, 'default', 'first room\'s')],
      ['Game speed (fps)', F.num(def, 'fps', edited, 60, '60')], ['First room', F.pick(pj, 'init_room', () => keys('rooms'), String, 'none', edited)],
      ...(gm ? [['Imported from', h('span', '', `${gm.game} (${gm.tool}, bytecode ${gm.bytecode})`)]] : [])]);
  }
  const VIEWS = {
    game: { label: 'Game', single: true, tabs: { props: gameProps }, title: () => 'Game settings', units: [['cfg_db_relay'], ['cfg_defaults'], ['cfg_project']] },
    functions: { label: 'Function', tabs: { code: codeTab('fn') }, title: (k, d) => `Function: ${k}(${(d.args || []).join(', ')})`,
      item: (k, d) => `${k}(${(d.args || []).join(', ')})`, create: () => ({ args: [], body: [] }) },
    rooms: { label: 'Room' },
    objects: { label: 'Object', tabs: { code: codeTab('obj'), props: objectProps },
      create: () => ({ sprite: null, parent: null, visible: true, persistent: false, scripts: [] }) },
    sprites: { label: 'Sprite', item: named }, sounds: { label: 'Sound', item: named }, fonts: { label: 'Font', item: named },
    tilesets: { label: 'Tile set' },
  };
  const TABS = { code: 'Code', props: 'Properties' };
  // Asset keys share one namespace (krpj.md): a new key must be free in all of these.
  const ASSET_FIELDS = ['sprites', 'sounds', 'fonts', 'objects', 'rooms', 'tilesets', 'paths', 'shaders', 'functions'];
  const ASSETS = { obj: 'objects', spr: 'sprites', snd: 'sounds', fnt: 'fonts', room: 'rooms', path: 'paths', shd: 'shaders' };
  for (const [t, field] of Object.entries(ASSETS)) C.sources[t] = () => keys(field);
  C.sources.as = () => Object.values(ASSETS).flatMap(keys).concat(keys('tilesets'));

  // ── the main window ──
  let cur = null; // { field, key, tab }: what the window shows; null = a scratch canvas outside the project
  const dataOf = (field, key) => VIEWS[field].single ? g() : (g()[field] || {})[key];
  const units = () => VIEWS[cur.field].units || [[cur.field, cur.key]];
  /** Writes pending canvas layout back and records any change as an undo step. */
  function flush() {
    if (!cur) return;
    if (C.current()) C.commit();
    for (const [f, k] of units()) P.touch(f, k);
  }
  function open(field, key = null, tab) {
    flush();
    const v = VIEWS[field], d = v && dataOf(field, key);
    if (!d) return clear();
    const names = Object.keys(v.tabs || {});
    cur = { field, key, tab: names.includes(tab) ? tab : names[0] || null };
    if (!names.includes('code')) C.open(null);
    kw.open(win);
    titleEl.textContent = v.title ? v.title(key, d) : `${v.label}: ${key}`;
    tabsEl.replaceChildren(...names.map((t) => { const b = h('span', 'wtab', TABS[t] || t); b.dataset.tab = t; return b; }));
    tabsEl.hidden = names.length < 2;
    show(cur.tab);
    for (const [f, k] of units()) P.watch(f, k); // after drawing: drawing may fill in defaults, which isn't an edit
  }
  function clear() {
    cur = null;
    C.open(null);
    titleEl.textContent = 'Code'; tabsEl.hidden = true; codePane.hidden = false; formPane.hidden = true;
  }
  function show(tab) {
    cur.tab = tab;
    for (const b of tabsEl.children) b.classList.toggle('on', b.dataset.tab === tab);
    codePane.hidden = tab !== 'code'; formPane.hidden = tab === 'code';
    const v = VIEWS[cur.field];
    if (!tab) return F.form(cur.key, [['', h('span', 'none', `There's no ${v.label.toLowerCase()} editor yet.`)]]);
    v.tabs[tab](dataOf(cur.field, cur.key), cur.key);
  }
  const redraw = () => { if (cur) show(cur.tab); };
  tabsEl.addEventListener('click', (e) => { const t = e.target.closest('.wtab'); if (t) show(t.dataset.tab); });
  C.onchange = flush;

  function create(field, key) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return alert(`"${key}" can't be a name: use letters, digits and _, not starting with a digit.`);
    const taken = ASSET_FIELDS.find((f) => (g()[f] || {})[key]);
    if (taken) return alert(`"${key}" is already used by ${taken}.`);
    flush();
    P.watch(field, key); // missing: undoing the creation removes it
    (g()[field] ||= {})[key] = VIEWS[field].create();
    P.touch(field, key);
    open(field, key);
  }

  // ── menus ──
  const anchorMenu = (el, list, value, onSet, search = true, make) => C.popup(el, list, value, onSet, search, make);
  function assetMenu(el, field) {
    const v = VIEWS[field];
    if (v.single) return open(field);
    const list = () => {
      const ks = keys(field);
      return ks.length ? ks.map((k) => [k, v.item ? v.item(k, g()[field][k]) : k]) : [[null, v.create ? 'type a name to create one' : 'none in this project']];
    };
    anchorMenu(el, v.create ? list : list(), cur && cur.field === field ? cur.key : undefined,
      (k) => { if (k == null) return; if (dataOf(field, k)) open(field, k); else create(field, k); }, true, 'create');
  }
  const discard = () => !proj.dirty && (cur || !C.stacks.length) || confirm('Discard unsaved changes?');
  const picker = h('input');
  picker.type = 'file'; picker.accept = '.krpj,.json';
  picker.onchange = async () => {
    const file = picker.files[0];
    picker.value = '';
    if (!file || !discard()) return;
    try { await P.load(file); } catch (e) { alert(`Couldn't import ${file.name}: ${e.message || e}`); }
  };
  function exportKrpj() {
    let blob;
    try { blob = P.save(); } catch (e) { return alert(`Couldn't export: ${e.message || e}`); }
    const a = h('a'); a.href = URL.createObjectURL(blob); a.download = proj.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const FILE = () => [[() => discard() && P.newProject(), 'New project'], [() => picker.click(), 'Import .krpj…'], [exportKrpj, 'Export .krpj']];
  for (const el of document.querySelectorAll('[data-menu]')) {
    el.addEventListener('click', () => el.dataset.menu === 'file' ? anchorMenu(el, FILE(), undefined, (f) => f && f(), false) : assetMenu(el, el.dataset.menu));
  }
  const ACTS = { undo: P.undo, redo: P.redo };
  const actBtns = document.querySelectorAll('[data-act=undo], [data-act=redo]');
  for (const b of actBtns) b.addEventListener('click', () => { if (cur) flush(); ACTS[b.dataset.act](); });
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.target.closest && e.target.closest('input, textarea'))) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) P.undo(); else if (k === 'y' || (k === 'z' && e.shiftKey)) P.redo(); else if (k === 's') exportKrpj(); else return;
    e.preventDefault();
  });
  addEventListener('beforeunload', (e) => { if (proj.dirty) e.preventDefault(); });

  // ── status: undo/redo availability, size meter, page title ──
  const meterEl = document.querySelector('.n1-complexity');
  let sizeTimer = 0;
  function status() {
    for (const b of actBtns) b.classList.toggle('off', !(b.dataset.act === 'undo' ? P.canUndo() : P.canRedo()));
    meterEl.textContent = (P.size() / 1048576).toFixed(2) + '/100MB';
    document.title = (proj.dirty ? '* ' : '') + proj.name + ' - kreditor';
  }
  P.on((type, e) => {
    if (type === 'load') open('game');
    else if (type === 'flush') flush();
    else if (type === 'change') { // game.json size: re-measured once edits pause
      clearTimeout(sizeTimer);
      sizeTimer = setTimeout(() => { proj.jsonBytes = JSON.stringify(g()).length; status(); }, 2000);
    } else if (type === 'history') { // show what changed
      const f = VIEWS[e.field] ? e.field : 'game', same = cur && cur.field === f;
      if (dataOf(f, e.key)) open(f, VIEWS[f].single ? null : e.key, same ? cur.tab : undefined);
      else if (cur && dataOf(cur.field, cur.key)) open(cur.field, cur.key, cur.tab);
      else clear();
    }
    status();
  });
  status();

  return { VIEWS, F, open, flush, current: () => cur };
})();
