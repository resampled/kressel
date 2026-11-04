// KRPJ project model helpers (see /docs/krpj.md)

export const KRPJ_VERSION = '0.1';

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
  if (!p.krpj_v) throw new Error('Not a KRPJ file (missing krpj_v)');
  return p;
}

export const serializeProject = (p) => JSON.stringify(p, null, 2);
