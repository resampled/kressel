// game.json project model helpers (see /docs/krpj.md)

export const KRPJ_VERSION = '0.2';

export function newProject(title = 'Untitled') {
  const now = Math.floor(Date.now() / 1000);
  return {
    krpj_v: KRPJ_VERSION,
    cfg_db_relay: { slug: '', title, author: '', revision: 1, date_created: now, date_updated: now },
    cfg_gm_compat: { imported_from: null },
    cfg_defaults: { width: 'default', height: 'default', fps: 60, window_title: title },
    cfg_project: { init_room: null },
    sprites: {},
    sounds: {},
    fonts: {},
  };
}

export function parseProject(text) {
  const p = JSON.parse(text);
  if (!p.krpj_v) throw new Error('Not a Kratience game.json (missing krpj_v)');
  migrateLayout(p);
  p.krpj_v = KRPJ_VERSION;
  return p;
}

/** krpj 0.1 kept canvas layout in an `editor` field; 0.2 keeps it on the scripts themselves ({ x, y, script, loose }). */
function migrateLayout(p) {
  const ed = p.editor;
  if (!ed) return;
  delete p.editor;
  const at = (id) => {
    const k = id.slice(id.indexOf(':') + 1);
    if (id === 'global') return { list: (p.global_init ??= []) };
    if (id.startsWith('fn:')) return p.functions?.[k] ? { fn: p.functions[k] } : null;
    const o = (id.startsWith('obj:') ? p.objects : id.startsWith('room:') ? p.rooms : null)?.[k];
    return o ? { list: o.scripts } : null;
  };
  for (const [id, ps] of Object.entries(ed.pos ?? {})) {
    const t = at(id);
    if (t?.fn) { if (ps?.[0]) [t.fn.x, t.fn.y] = ps[0]; }
    else if (t) ps?.forEach((xy, i) => { if (xy && t.list[i] !== undefined) t.list[i] = { x: xy[0], y: xy[1], script: t.list[i] }; });
  }
  for (const [id, ls] of Object.entries(ed.loose ?? {})) {
    const t = at(id), list = t?.fn ? (t.fn.loose ??= []) : t?.list;
    for (const l of list ? ls : []) list.push({ x: l.x, y: l.y, loose: true, script: l.script });
  }
}

export const serializeProject = (p) => JSON.stringify(p, null, 2);
