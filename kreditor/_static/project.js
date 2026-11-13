// The open project: [File] imports a .krpj (or game.json); the Functions and Objects dropdowns list the project's
// functions/objects (searchable) and open the chosen one in the code window. Needs krpj.js, windows.js, codeblocks.js.
var kreditorProject = (function () {
  'use strict';
  const proj = { game: null, files: new Map(), name: '' };
  const codeWin = document.querySelector('.w-code').closest('.w');
  let cur = null; // [kind, key] open in the code window
  const ASSETS = { obj: 'objects', spr: 'sprites', snd: 'sounds', fnt: 'fonts', room: 'rooms', path: 'paths', shd: 'shaders' };
  const keys = (field) => Object.keys((proj.game && proj.game[field]) || {});
  for (const [t, field] of Object.entries(ASSETS)) kreditorCode.sources[t] = () => keys(field);
  kreditorCode.sources.as = () => Object.values(ASSETS).flatMap(keys).concat(keys('tilesets'));

  const picker = h('input');
  picker.type = 'file'; picker.accept = '.krpj,.json';
  picker.onchange = () => { if (picker.files[0]) load(picker.files[0]); picker.value = ''; };
  function h(name, cls, ...kids) {
    const e = document.createElement(name);
    if (cls) e.className = cls;
    e.append(...kids);
    return e;
  }

  async function load(file) {
    if ((proj.game || kreditorCode.stacks.length) && !confirm('Replace the open project? Unsaved changes will be lost.')) return;
    try {
      const { game, files } = await kreditorKrpj.read(new Uint8Array(await file.arrayBuffer()));
      Object.assign(proj, { game, files, name: file.name });
      edit(null);
    } catch (e) { alert(`Couldn't import ${file.name}: ${e.message || e}`); }
  }

  /** Opens a function ('fn') or object ('obj') in the code window; null clears it. */
  function edit(kind, key) {
    const g = proj.game, data = kind && (kind === 'fn' ? g.functions : g.objects)[key];
    cur = data ? [kind, key] : null;
    kw.open(codeWin);
    const title = !data ? 'Code' : kind === 'fn' ? `Code: function ${key}(${(data.args || []).join(', ')})` : `Object: ${key}`;
    codeWin.querySelector('.wtitle').textContent = title;
    tabs.hidden = kind !== 'obj';
    tab('code');
    kreditorCode.open(data ? kind : null, data || null);
  }

  // ── Code / Properties tabs (objects only) ──
  const tabs = codeWin.querySelector('.wtabs'), codePane = codeWin.querySelector('.w-code'), propPane = codeWin.querySelector('.w-props');
  function tab(t) {
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === t);
    codePane.hidden = t !== 'code'; propPane.hidden = t !== 'props';
    if (t === 'props') props();
  }
  tabs.addEventListener('click', (e) => { const t = e.target.closest('.wtab'); if (t) tab(t.dataset.tab); });

  /** The open object's fields (krpj.md, Objects). Edits write straight into game.json. */
  function props() {
    const key = cur[1], o = proj.game.objects[key], sprites = proj.game.sprites || {};
    const sprLabel = (k) => sprites[k] && sprites[k].name && sprites[k].name !== k ? `${k} (${sprites[k].name})` : k;
    // parent: any object that doesn't already inherit from this one (no cycles)
    const inherits = (k) => { for (let i = 0; k && i < 1e4; i++, k = (proj.game.objects[k] || {}).parent) if (k === key) return true; return false; };
    const pick = (field, ks, label, none) => {
      const v = o[field] ?? null, b = h('span', 'dd' + (v == null ? ' none' : ''), v == null ? none : label(v));
      b.onclick = () => kreditorCode.popup(b, [[null, none], ...ks().map((k) => [k, label(k)])], v, (x) => { o[field] = x; props(); });
      return b;
    };
    const check = (field, def) => {
      const c = h('input'); c.type = 'checkbox'; c.checked = o[field] ?? def;
      c.onchange = () => { o[field] = c.checked; };
      return c;
    };
    const depth = h('input'); depth.type = 'number'; depth.value = o.depth ?? ''; depth.placeholder = '0';
    depth.onchange = () => { if (depth.value === '') delete o.depth; else o.depth = Number(depth.value); };
    const rows = [['Sprite', pick('sprite', () => keys('sprites'), sprLabel, 'none')],
      ['Collision mask', pick('mask', () => keys('sprites'), sprLabel, 'same as sprite')],
      ['Parent', pick('parent', () => keys('objects').filter((k) => !inherits(k)), (k) => k, 'none')],
      ['Depth', depth], ['Visible', check('visible', true)], ['Solid', check('solid', false)], ['Persistent', check('persistent', false)]];
    propPane.replaceChildren(h('h3', '', key), ...rows.flatMap(([l, input]) => [h('label', '', l), input]),
      ...(o.imported_from ? [h('label', '', 'Imported from'), h('span', '', o.imported_from)] : []));
  }

  const MENUS = {
    file: () => [[() => picker.click(), 'Import .krpj…']],
    functions: () => list('fn', keys('functions'), (k) => `${k}(${(proj.game.functions[k].args || []).join(', ')})`),
    objects: () => list('obj', keys('objects'), (k) => k),
  };
  function list(kind, ks, label) {
    if (!ks.length) return [[null, proj.game ? 'none in this project' : 'import a .krpj first']];
    return ks.map((k) => [() => edit(kind, k), label(k), kind + ':' + k]);
  }
  for (const el of document.querySelectorAll('[data-menu]')) {
    el.addEventListener('click', () => {
      const items = MENUS[el.dataset.menu](), now = cur && items.find((it) => it[2] === cur.join(':'));
      kreditorCode.popup(el, items.map(([f, l]) => [f, l]), now ? now[0] : undefined, (f) => f && f(), el.dataset.menu !== 'file');
    });
  }

  return { proj, edit };
})();
