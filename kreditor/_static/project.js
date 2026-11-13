// The open project (game.json + asset files) and its edit history. No UI here: views.js draws it.
// Edits happen in place on `proj.game`. History works per unit (one asset `game[field][key]`, or a whole field
// `game[field]` when key is null): watch(unit) records its state when a view opens it, and touch(unit) after an edit
// compares against that and, if it changed, pushes one undo step. So undo costs a JSON copy of the edited unit only.
// Events (on(fn), fn(type, detail)): 'load' (new/imported project), 'change' {field, key}, 'history' {field, key},
// 'flush' (before saving: views write pending edits back), 'save'.
var kreditorProject = (function () {
  'use strict';
  const K = kreditorKrpj, MAX_UNDO = 200;
  const proj = { game: K.newProject(), files: new Map(), name: 'untitled.krpj', dirty: false, jsonBytes: 0 };
  const undo = [], redo = [], snap = new Map(), listeners = [];
  const on = (fn) => listeners.push(fn);
  const emit = (type, detail) => { for (const fn of listeners) fn(type, detail); };

  const id = (field, key) => key == null ? field : field + '\n' + key;
  const get = (field, key) => key == null ? proj.game[field] : (proj.game[field] || {})[key];
  function put(field, key, v) {
    const into = key == null ? proj.game : (proj.game[field] ||= {}), k = key == null ? field : key;
    if (v === undefined) delete into[k]; else into[k] = v;
  }
  const json = (field, key) => JSON.stringify(get(field, key)); // undefined for a missing unit
  function watch(field, key = null) { snap.set(id(field, key), json(field, key)); }
  function touch(field, key = null) {
    const k = id(field, key), now = json(field, key);
    if (!snap.has(k)) { snap.set(k, now); return; } // never watched: nothing to compare to
    const before = snap.get(k);
    if (now === before) return;
    snap.set(k, now);
    undo.push({ field, key, before, after: now });
    if (undo.length > MAX_UNDO) undo.shift();
    redo.length = 0;
    proj.dirty = true;
    emit('change', { field, key });
  }
  function step(from, to, side) {
    const e = from.pop();
    if (!e) return false;
    to.push(e);
    put(e.field, e.key, e[side] === undefined ? undefined : JSON.parse(e[side]));
    snap.set(id(e.field, e.key), e[side]);
    proj.dirty = true;
    emit('history', e);
    return true;
  }

  function reset(game, files, name) {
    Object.assign(proj, { game, files, name, dirty: false });
    proj.jsonBytes = JSON.stringify(game).length;
    undo.length = redo.length = 0; snap.clear();
    emit('load');
  }
  /** Opens a .krpj or game.json File. Throws on a bad file (the open project is kept). */
  async function load(file) {
    const { game, files } = await K.read(new Uint8Array(await file.arrayBuffer()));
    reset(game, files, file.name.replace(/\.json$/i, '.krpj'));
  }
  /** The project as a .krpj Blob (views flush pending edits first). */
  function save() {
    emit('flush');
    const g = proj.game;
    if (g.cfg_db_relay) { // not an edit: keep it out of the history
      g.cfg_db_relay.date_updated = Math.floor(Date.now() / 1000);
      if (snap.has(id('cfg_db_relay'))) watch('cfg_db_relay');
    }
    const text = JSON.stringify(g), blob = K.write(text, proj.files);
    proj.jsonBytes = text.length; proj.dirty = false;
    emit('save');
    return blob;
  }
  /** Approximate project size in bytes: asset files + game.json as of the last load/save. */
  const size = () => { let n = proj.jsonBytes; for (const d of proj.files.values()) n += d.length; return n; };

  return {
    proj, on, watch, touch, load, save, size,
    newProject: () => reset(K.newProject(), new Map(), 'untitled.krpj'),
    undo: () => step(undo, redo, 'before'), redo: () => step(redo, undo, 'after'),
    canUndo: () => undo.length > 0, canRedo: () => redo.length > 0,
  };
})();
