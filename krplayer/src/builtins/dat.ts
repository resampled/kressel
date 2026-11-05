// Files & data (dat_*): ds_*, JSON, ini, text files and buffers.

import { define, family, n, str, opt } from './registry.ts';
import { compare, equals, GmlError, GmStruct, real, type GArray, type Value } from '../value.ts';
import { Buffer, DS, DsList, DsMap, Ini, iniReal, listRead, listWrite, readLn, readReal, readString } from '../runtime/data.ts';
import type { Game } from '../runtime/game.ts';
import { gstr } from './opr.ts';

const list = (g: Game, v: Value) => g.data.lists.get(v, 'ds_list');
const map = (g: Game, v: Value) => g.data.maps.get(v, 'ds_map');

define('dat_list_create', (g) => g.data.lists.add(new DsList()));
define('dat_list_destroy', (g, s, t) => { g.data.lists.free(s[t]); return undefined; });
define('dat_list_add', (g, s, t, argc) => { const l = list(g, s[t]); for (let k = 1; k < argc; k++) l.a.push(s[t - k]); return undefined; });
define('dat_list_get', (g, s, t) => { const i = Math.trunc(n(s, t, 1)), l = list(g, s[t]); return i >= 0 && i < l.a.length ? l.a[i] : undefined; });
define('dat_list_set', (g, s, t) => {
  const l = list(g, s[t]), i = Math.trunc(n(s, t, 1));
  while (l.a.length < i) l.a.push(0);
  l.a[i] = s[t - 2];
  return undefined;
});
define('dat_list_delete', (g, s, t) => { list(g, s[t]).a.splice(Math.trunc(n(s, t, 1)), 1); return undefined; });
define('dat_list_size', (g, s, t) => list(g, s[t]).a.length);
define('dat_list_index_of', (g, s, t) => list(g, s[t]).a.findIndex((x) => equals(x, s[t - 1])));
define('dat_list_clear', (g, s, t) => { list(g, s[t]).a = []; return undefined; });
define('dat_list_sort', (g, s, t) => { const asc = real(s[t - 1]) > 0.5; list(g, s[t]).a.sort((x, y) => (asc ? compare(x, y) : compare(y, x))); return undefined; });
define('dat_list_write', (g, s, t) => listWrite(list(g, s[t])));
define('dat_list_read', (g, s, t) => { listRead(list(g, s[t]), str(s, t, 1)); return undefined; });

define('dat_map_create', (g) => g.data.maps.add(new DsMap()));
define('dat_map_destroy', (g, s, t) => { if (g.data.maps.has(s[t])) g.data.destroyMap(s[t]); return undefined; });
define('dat_map_exists', (g, s, t) => map(g, s[t]).m.has(s[t - 1]));
define('dat_map_get', (g, s, t) => map(g, s[t]).m.get(s[t - 1]));
define('dat_map_set', (g, s, t) => { map(g, s[t]).m.set(s[t - 1], s[t - 2]); return undefined; });
define('dat_map_add', (g, s, t) => { const m = map(g, s[t]).m; if (m.has(s[t - 1])) return false; m.set(s[t - 1], s[t - 2]); return true; });
define('dat_map_delete', (g, s, t) => { map(g, s[t]).m.delete(s[t - 1]); return undefined; });
define('dat_map_size', (g, s, t) => map(g, s[t]).m.size);
define('dat_map_first', (g, s, t) => map(g, s[t]).m.keys().next().value);
define('dat_map_next', (g, s, t) => {
  const keys = [...map(g, s[t]).m.keys()], i = keys.findIndex((k) => k === s[t - 1]);
  return i >= 0 && i + 1 < keys.length ? keys[i + 1] : undefined;
});
define('dat_map_keys', (g, s, t) => [...map(g, s[t]).m.keys()] as GArray);

define('dat_grid_create', (g, s, t) => { const w = Math.trunc(n(s, t, 0)), h = Math.trunc(n(s, t, 1)); return g.data.grids.add({ w, h, a: new Array(w * h).fill(0) }); });
define('dat_grid_get', (g, s, t) => { const gr = g.data.grids.get(s[t], 'ds_grid'), x = Math.trunc(n(s, t, 1)), y = Math.trunc(n(s, t, 2)); return x >= 0 && y >= 0 && x < gr.w && y < gr.h ? gr.a[y * gr.w + x] : undefined; });
define('dat_grid_set', (g, s, t) => { const gr = g.data.grids.get(s[t], 'ds_grid'), x = Math.trunc(n(s, t, 1)), y = Math.trunc(n(s, t, 2)); if (x >= 0 && y >= 0 && x < gr.w && y < gr.h) gr.a[y * gr.w + x] = s[t - 3]; return undefined; });
define('dat_grid_size', (g, s, t) => { const gr = g.data.grids.get(s[t - 1], 'ds_grid'); return s[t] === 'width' ? gr.w : gr.h; });
define('dat_grid_clear', (g, s, t) => { g.data.grids.get(s[t], 'ds_grid').a.fill(s[t - 1]); return undefined; });
define('dat_grid_destroy', (g, s, t) => { g.data.grids.free(s[t]); return undefined; });
define('dat_exists', (g, s, t) => g.data.exists(s[t], n(s, t, 1)));
void DS;

// ---------------------------------------------------------------- JSON

define('dat_json_decode', (g, s, t) => g.data.jsonDecode(str(s, t, 0)));
define('dat_json_encode', (g, s, t) => g.data.jsonEncode(n(s, t, 0)));
define('dat_json_parse', (g, s, t) => {
  let v: unknown;
  try { v = JSON.parse(str(s, t, 0)); } catch (e) { throw new GmlError(`json_parse: ${(e as Error).message}`); }
  const conv = (x: unknown): Value => {
    if (x === null) return undefined;
    if (Array.isArray(x)) return x.map(conv);
    if (typeof x === 'object') { const st = new GmStruct(); for (const [k, y] of Object.entries(x)) st.vars.set(g.a.varSlot(k), conv(y)); return st; }
    return x as Value;
  };
  return conv(v);
});
define('dat_json_stringify', (g, s, t) => {
  const conv = (x: Value): unknown => {
    if (Array.isArray(x)) return x.map(conv);
    if (x instanceof GmStruct) return Object.fromEntries([...x.vars].map(([k, y]) => [g.a.varNames[k], conv(y)]));
    return x === undefined ? null : x;
  };
  return JSON.stringify(conv(s[t]));
});

// ---------------------------------------------------------------- ini

function ini(g: Game) {
  if (!g.ini) throw new GmlError('no ini file is open');
  return g.ini;
}
define('dat_ini_open', (g, s, t) => {
  if (g.ini) throw new GmlError('ini_open: an ini file is already open');
  const path = str(s, t, 0);
  g.ini = { path, ini: new Ini(g.files.readText(path) ?? ''), dirty: false };
  return undefined;
});
define('dat_ini_open_string', (g, s, t) => { g.ini = { path: '', ini: new Ini(str(s, t, 0)), dirty: false }; return undefined; });
define('dat_ini_close', (g) => {
  const f = ini(g), text = f.ini.toString();
  if (f.dirty && f.path) g.files.writeText(f.path, text);
  g.ini = null;
  return text;
});
define('dat_ini_read', (g, s, t) => {
  const v = ini(g).ini.read(str(s, t, 1), str(s, t, 2));
  return s[t] === 'real' ? iniReal(v, s[t - 3]) : v ?? s[t - 3];
});
define('dat_ini_write', (g, s, t) => {
  const f = ini(g);
  f.ini.write(str(s, t, 1), str(s, t, 2), gstr(g, s[t - 3]));
  f.dirty = true;
  return undefined;
});
define('dat_ini_section_exists', (g, s, t) => ini(g).ini.sections.has(str(s, t, 0)));
define('dat_ini_key_exists', (g, s, t) => ini(g).ini.read(str(s, t, 0), str(s, t, 1)) !== undefined);
define('dat_ini_key_delete', (g, s, t) => { const f = ini(g); f.ini.sections.get(str(s, t, 0))?.delete(str(s, t, 1)); f.dirty = true; return undefined; });
define('dat_ini_section_delete', (g, s, t) => { const f = ini(g); f.ini.sections.delete(str(s, t, 0)); f.dirty = true; return undefined; });

// ---------------------------------------------------------------- files

define('dat_file_exists', (g, s, t) => g.files.exists(str(s, t, 0)));
define('dat_file_delete', (g, s, t) => { g.files.remove(str(s, t, 0)); return true; });
define('dat_file_copy', (g, s, t) => { g.files.copy(str(s, t, 0), str(s, t, 1)); return undefined; });
define('dat_file_rename', (g, s, t) => { g.files.copy(str(s, t, 0), str(s, t, 1)); g.files.remove(str(s, t, 0)); return true; });
define('dat_dir_exists', () => true);
define('dat_dir_create', () => undefined);

const file = (g: Game, v: Value) => {
  const f = g.textFiles.get(real(v));
  if (!f) throw new GmlError(`text file ${String(v)} is not open`);
  return f;
};
define('dat_text_open', (g, s, t) => {
  const path = str(s, t, 1), mode = s[t];
  if (mode === 'read') {
    const text = g.files.readText(path);
    if (text === null) return -1;
    g.textFiles.set(g.nextFile, { path, mode: 'read', text, pos: 0 });
  } else {
    g.textFiles.set(g.nextFile, { path, mode: 'write', text: mode === 'append' ? g.files.readText(path) ?? '' : '', pos: 0 });
  }
  return g.nextFile++;
});
define('dat_text_close', (g, s, t) => {
  const f = file(g, s[t]);
  if (f.mode === 'write') g.files.writeText(f.path, f.text);
  g.textFiles.delete(real(s[t]));
  return undefined;
});
define('dat_text_read', (g, s, t) => (s[t] === 'real' ? readReal(file(g, s[t - 1])) : readString(file(g, s[t - 1]))));
define('dat_text_readln', (g, s, t) => readLn(file(g, s[t])));
define('dat_text_eof', (g, s, t) => { const f = file(g, s[t]); return f.pos >= f.text.length; });
define('dat_text_write', (g, s, t) => { const f = file(g, s[t - 1]); f.text += s[t] === 'real' ? ' ' + gstr(g, s[t - 2]) : gstr(g, s[t - 2]); return undefined; });
define('dat_text_writeln', (g, s, t) => { file(g, s[t]).text += '\r\n'; return undefined; });

define('dat_encode', (_g, s, t) => {
  const x = str(s, t, 1);
  switch (s[t]) {
    case 'base64_encode': return btoa(String.fromCharCode(...new TextEncoder().encode(x)));
    case 'base64_decode': try { return new TextDecoder().decode(Uint8Array.from(atob(x), (c) => c.charCodeAt(0))); } catch { return ''; }
  }
  throw new GmlError(`${String(s[t])} is not implemented in krplayer yet`);
});

// ---------------------------------------------------------------- buffers

const buf = (g: Game, v: Value) => g.data.buffers.get(v, 'buffer');
let asyncIds = 1;
family('dat_buffer', 'buffer_', {
  create: (g, s, t) => g.data.buffers.add(new Buffer(Math.trunc(n(s, t, 0)), n(s, t, 1), n(s, t, 2))),
  delete: (g, s, t) => { g.data.buffers.free(s[t]); return undefined; },
  exists: (g, s, t) => g.data.buffers.has(s[t]),
  write: (g, s, t) => { buf(g, s[t]).write(n(s, t, 1), s[t - 2]); return 0; },
  read: (g, s, t) => buf(g, s[t]).read(n(s, t, 1)),
  seek: (g, s, t) => { const bf = buf(g, s[t]), base = n(s, t, 1); bf.pos = Math.max(0, (base === 0 ? 0 : base === 1 ? bf.pos : bf.data.length) + n(s, t, 2)); return undefined; },
  tell: (g, s, t) => buf(g, s[t]).pos,
  get_size: (g, s, t) => buf(g, s[t]).data.length,
  load: (g, s, t) => { const d = g.files.readBytes(str(s, t, 0)); return d ? g.data.buffers.add(Buffer.from(d)) : -1; },
  save: (g, s, t) => { g.files.writeBytes(str(s, t, 1), buf(g, s[t]).data); return undefined; },
  // Async saves/loads complete straight away; the Save/Load async event fires at the start of the next step.
  save_async: (g, s, t, argc) => {
    const bf = buf(g, s[t]), off = opt(s, t, 2, argc, 0), size = opt(s, t, 3, argc, bf.data.length);
    g.files.writeBytes(str(s, t, 1), bf.data.subarray(off, off + size));
    const id = asyncIds++;
    g.queueAsync('save_load', { id, status: true });
    return id;
  },
  load_async: (g, s, t, argc) => {
    const bf = buf(g, s[t]), d = g.files.readBytes(str(s, t, 1)), off = opt(s, t, 2, argc, 0);
    if (d) { if (bf.data.length < off + d.length) { const nd = new Uint8Array(off + d.length); nd.set(bf.data); bf.data = nd; bf.view = new DataView(nd.buffer); } bf.data.set(d, off); }
    const id = asyncIds++;
    g.queueAsync('save_load', { id, status: d !== null });
    return id;
  },
  async_group_begin: () => undefined,
  async_group_option: () => undefined,
  async_group_end: (g) => { const id = asyncIds++; g.queueAsync('save_load', { id, status: true }); return id; },
});
