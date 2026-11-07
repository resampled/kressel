// Visual scripts: renders krpj script trees (docs/krpj_opcodes.md) as Scratch-style blocks, generated from the
// opcode table, and edits them in place. Blocks are dragged with the pointer: a statement takes the blocks
// below it along, drops snap into stacks/inputs, and anything else lands loose on the canvas (a loose entry).
import { OPCODES } from './opcodes.gen.js';
import { app, el, commit, coll, KINDS } from './state.js';

// ── opcode metadata ──
const CAT = { evt: 'evt', ctr: 'ctl', fnc: 'fnc', opr: 'opr', var: 'var', ins: 'ins', mov: 'mov', sen: 'sen', lks: 'lks',
  snd: 'snd', drw: 'drw', rom: 'rom', cam: 'cam', dat: 'dat', sys: 'sys', _: 'var' };
export const CATS = [['evt', 'Events'], ['ctr', 'Control'], ['fnc', 'Functions'], ['opr', 'Operators'], ['var', 'Variables'],
  ['ins', 'Instances'], ['mov', 'Movement'], ['sen', 'Sensing'], ['lks', 'Looks'], ['snd', 'Sound'], ['drw', 'Drawing'],
  ['rom', 'Rooms'], ['cam', 'Camera'], ['dat', 'Data'], ['sys', 'System']];

function parseArgs(s) {
  if (!s || s === '-') return [];
  return s.split(/,\s*/).map((a) => {
    const m = /^([a-z/]*)(\?)?(\.\.\.)?\s*(.*)$/.exec(a.trim());
    let type = m[1] || 'any';
    if (type.includes('/')) type = type.startsWith('inst') ? 'inst' : 'any';
    const opts = [...m[4].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
    return { type, opt: !!m[2], rest: !!m[3], opts, name: m[4].replace(/`[^`]*`|\(.*\)|\//g, '').trim() };
  });
}
const A = (name) => ({ type: 'any', opt: false, rest: false, opts: [], name });
const UNARY = new Set(['opr_neg', 'opr_not', 'opr_bnot']);
export const OPS = new Map(OPCODES.map((o) => {
  let args = parseArgs(o.args);
  if (o.args === null && o.name.startsWith('opr_')) args = o.name === 'opr_cond' ? [A('c'), A('a'), A('b')] : UNARY.has(o.name) ? [A('a')] : [A('a'), A('b')];
  const gml = /`([a-z0-9_]+)/.exec(o.gml ?? '')?.[1];
  return [o.name, { ...o, args, cat: o.name.startsWith('_') ? '_' : o.name.split('_')[0], gml }];
}));
const REF_OPTS = {
  evt_key: ['pressed', 'held', 'released'],
  evt_mouse: ['left_pressed', 'left_held', 'left_released', 'right_pressed', 'right_held', 'right_released', 'middle_pressed',
    'middle_held', 'middle_released', 'none', 'enter', 'leave', 'wheel_up', 'wheel_down', 'global_left_pressed', 'global_left_held', 'global_left_released'],
  var_change: ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '??'],
  _kw: ['self', 'other', 'all', 'noone', 'global'],
};
const KEYS = { 0: 'no key', 1: 'any key', 8: 'backspace', 9: 'tab', 13: 'enter', 16: 'shift', 17: 'control', 18: 'alt', 27: 'escape',
  32: 'space', 37: 'left arrow', 38: 'up arrow', 39: 'right arrow', 40: 'down arrow' };
for (let c = 65; c <= 90; c++) KEYS[c] = String.fromCharCode(c);
for (let c = 48; c <= 57; c++) KEYS[c] = String.fromCharCode(c);
for (let f = 1; f <= 12; f++) KEYS[111 + f] = 'F' + f;

// %n = argument n (node[n]); script arguments become C-block mouths.
const LABELS = {
  evt_create: 'on create', evt_destroy: 'on destroy', evt_cleanup: 'on clean up', evt_step: 'on step', evt_step_begin: 'on begin step',
  evt_step_end: 'on end step', evt_alarm: 'on alarm %1', evt_draw: 'on draw', evt_draw_begin: 'on begin draw', evt_draw_end: 'on end draw',
  evt_drawgui: 'on draw GUI', evt_drawgui_begin: 'on begin draw GUI', evt_drawgui_end: 'on end draw GUI', evt_collision: 'on touching %1',
  evt_key: 'on key %2 %1', evt_mouse: 'on mouse %1', evt_user: 'on user event %1', evt_room_start: 'on room start', evt_room_end: 'on room end',
  evt_game_start: 'on game start', evt_game_end: 'on game end', evt_animation_end: 'on animation end', evt_path_end: 'on path end',
  evt_outside_room: 'on leaving the room', evt_intersect_boundary: 'on touching the room edge',
  ctr_if: 'if %1 then %2 else %3', ctr_repeat: 'repeat %1 %2', ctr_while: 'while %1 %2', ctr_do_until: 'do %1 until %2',
  ctr_for: 'for %1 while %2 each time %3 do %4', ctr_for_each: 'for each %1 in %2 %3', ctr_switch: 'switch %1 %2', ctr_case: 'case %1',
  ctr_default: 'default', ctr_break: 'break', ctr_continue: 'continue', ctr_with: 'as each %1 %2', ctr_exit: 'stop this event',
  ctr_return: 'return %1', ctr_alarm_set: 'set alarm %1 to %2', ctr_alarm_get: 'alarm %1',
  var_set: 'set %1 to %2', var_change: 'change %2 by %1 %3', var_inc: 'increase %1', var_dec: 'decrease %1', var_local: 'local %1 = %2',
  fnc_g: 'call %1 %2', fnc_m: 'call method %1 %2',
  opr_add: '%1 + %2', opr_sub: '%1 − %2', opr_mul: '%1 × %2', opr_div: '%1 ÷ %2', opr_idiv: '%1 div %2', opr_mod: '%1 mod %2',
  opr_neg: '− %1', opr_eq: '%1 = %2', opr_neq: '%1 ≠ %2', opr_lt: '%1 < %2', opr_lte: '%1 ≤ %2', opr_gt: '%1 > %2', opr_gte: '%1 ≥ %2',
  opr_and: '%1 and %2', opr_or: '%1 or %2', opr_xor: '%1 xor %2', opr_not: 'not %1', opr_cond: 'if %1 then %2 else %3',
  opr_random: 'random %1', opr_string: 'string of %1',
  _iv: '%1 . %2', _ar: '[ %1 ]', _ai: '%1 [ %2 ]',
  sen_key_held: 'key %1 held?', sen_key_pressed: 'key %1 pressed?', sen_key_released: 'key %1 released?',
  sen_place_meeting: 'touching %3 at x %1 y %2?',
  ins_create_layer: 'create %4 at x %1 y %2 on layer %3', ins_create_depth: 'create %4 at x %1 y %2 depth %3', ins_destroy: 'destroy %1',
  ins_exists: '%1 exists?', ins_number: 'number of %1', ins_event_inherited: 'run parent event',
  mov_motion_set: 'move at speed %2 toward %1°', mov_motion_add: 'push toward %1° by %2', mov_wrap: 'wrap around room h %1 v %2 margin %3',
  snd_play: 'play sound %1 priority %2 loop %3', snd_stop: 'stop sound %1', snd_stop_all: 'stop all sounds',
  drw_self: 'draw myself', drw_text: 'draw text %3 at x %1 y %2', drw_set_font: 'set font %1', drw_set_colour: 'set colour %1',
  drw_sprite: 'draw %1 frame %2 at x %3 y %4', drw_rect: 'draw rectangle %1 %2 to %3 %4 outline %5',
  rom_goto: 'go to room %1', rom_change: 'go to %1 room', sys_log: 'log %1', sys_game_end: 'end game', sys_game_restart: 'restart game',
};
const STMT_ONLY = new Set(['var_set', 'var_change', 'var_local', 'var_static', 'var_globalvar', 'var_delete', 'ctr_case', 'ctr_default',
  'ctr_break', 'ctr_continue', 'ctr_exit', 'ctr_return', 'ctr_throw']);
const isHat = (n) => Array.isArray(n) && typeof n[0] === 'string' && n[0].startsWith('evt_');
const isOp = (n) => Array.isArray(n) && typeof n[0] === 'string';
const canReport = (n) => isOp(n) && !isHat(n) && !STMT_ONLY.has(n[0]) && !(OPS.get(n[0])?.args.some((a) => a.type === 'script') && n[0] !== 'fnc_def');
const BOOLISH = /^opr_(eq|neq|lt|lte|gt|gte|and|or|xor|not)$|^sen_(key|place|position|mouse_(held|pressed|released))|_exists$|_is_|^ins_is/;
const REPORTERISH = /_get|_is|exists|number|_find|nearest|furthest|_info|_size|length|_count|_timer|_now|_date|_make_colour|_merge_colour|_id$/;
const reporterish = (name) => /^(opr|_|sen|lks)/.test(name) || REPORTERISH.test(name);

// ── values ──
const ASSET_FIELD = { obj: 'objects', spr: 'sprites', snd: 'sounds', fnt: 'fonts', room: 'rooms' };
const keysOf = (field) => Object.keys(app.project[field] ?? {});
const firstAs = (type) => { const k = type === 'as' ? allAssetKeys()[0] : keysOf(ASSET_FIELD[type])[0]; return k ? ['_as', k] : null; };
const allAssetKeys = () => KINDS.flatMap(([f]) => keysOf(f));
function defaultFor(a, name) {
  if (a.type === 'script') return [];
  if (a.type === 'ref') return a.opts[0] ?? REF_OPTS[name]?.[0] ?? (name === 'fnc_g' ? keysOf('functions')[0] ?? '' : name === 'var_local' ? 'temp' : name === 'ctr_for_each' ? 'item' : '');
  if (a.type === 'var') return ['_lv', 'myvar'];
  if (a.type === 'any') return name === 'ctr_if' ? true : name === 'ctr_while' ? false : name === 'var_change' ? 1 : /^(opr_|var_)/.test(name) ? 0 : '';
  if (a.type === 'inst') return firstAs('obj') ?? ['_kw', 'self'];
  if (ASSET_FIELD[a.type] || a.type === 'as') return firstAs(a.type);
  return { str: '', bool: true, key: 32, col: 16777215, arr: ['_ar'], struct: {}, layer: 'Instances', fn: keysOf('functions')[0] ? ['_fn', keysOf('functions')[0]] : null }[a.type] ?? (a.type === 'num' || a.type === 'ds' ? 0 : null);
}
const HAND = { _lv: () => ['_lv', 'myvar'], _iv: () => ['_iv', ['_kw', 'global'], 'myvar'], _kw: () => ['_kw', 'self'], _ar: () => ['_ar'],
  _ai: () => ['_ai', ['_lv', 'myarray'], 0], _as: () => ['_as', allAssetKeys()[0] ?? ''], _fn: () => ['_fn', keysOf('functions')[0] ?? ''] };
export function template(name, fnKey) {
  if (HAND[name]) return HAND[name]();
  const info = OPS.get(name), n = [name];
  for (const a of info.args) {
    if (a.opt) break;
    n.push(fnKey && n.length === 1 ? fnKey : defaultFor(a, name));
    if (a.rest) break;
  }
  if (name === 'fnc_g' && fnKey) { n.length = 2; for (const _ of app.project.functions[fnKey]?.args ?? []) n.push(0); }
  if (name.startsWith('evt_')) n.push([]);
  return n;
}
const NUM = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
function parseLit(text, type) {
  if (/^".*"$/s.test(text) && text.length > 1) return text.slice(1, -1);
  if (type === 'str') return text;
  if (NUM.test(text.trim())) return Number(text);
  if (type === 'any' && (text === 'true' || text === 'false')) return text === 'true';
  return text;
}
const showLit = (v, type) => v == null ? '' : typeof v === 'string' && type !== 'str' && NUM.test(v.trim()) ? `"${v}"` : String(v);
const bgr2hex = (c) => '#' + [c & 255, (c >> 8) & 255, (c >> 16) & 255].map((x) => x.toString(16).padStart(2, '0')).join('');
const hex2bgr = (h) => { const n = parseInt(h.slice(1), 16); return ((n & 255) << 16) | (n & 0xff00) | (n >> 16); };

// ── rendering ──
const refs = new WeakMap();
const tag = (e, ref) => (refs.set(e, ref), e);
const set = (node, i, v) => { node[i] = v; commit(); };
const fit = (inp) => { inp.style.width = `calc(${Math.max(1, inp.value.length)}ch + 16px)`; };
function textIn(value, onSet, cls = '') {
  const inp = el('input.in' + cls, { value, spellcheck: false, oninput: () => fit(inp), onchange: () => onSet(inp.value) });
  fit(inp);
  return inp;
}
/** A dropdown. options: [value, label][] or a function returning them, filled in when first opened (asset lists can be long). */
function pick(options, value, onSet, cls = '') {
  const list = () => (typeof options === 'function' ? options() : options);
  const label = typeof options === 'function' ? String(value ?? '').replace(/^(kw|as):/, '') : list().find(([v]) => v === value)?.[1];
  const s = el('select.dd' + cls, { onchange: () => onSet(s.value) }, el('option', { value, textContent: label || value || '(none)' }));
  const fill = () => {
    if (s.dataset.full) return;
    s.dataset.full = '1';
    s.append(...list().filter(([v]) => v !== value).map(([v, l]) => el('option', { value: v, textContent: l })));
  };
  s.addEventListener('pointerdown', fill); s.addEventListener('focus', fill); s.addEventListener('keydown', fill);
  return s;
}
const assetOpts = (type) => () => (type === 'as' ? allAssetKeys() : keysOf(ASSET_FIELD[type])).map((k) => [k, k]);

/** An input slot for node[i]: an inline editor for literals/asset picks, or the nested reporter block. */
function slot(node, i, a, ctx) {
  const v = node[i], t = a.type;
  const wrap = (c) => tag(el('span.slot', {}, c), { t: 'slot', node, i, spec: a });
  if (t === 'var' && isOp(v) && v[0] === '_lv') return wrap(textIn(v[1], (s) => set(node, i, ['_lv', s]), '.vname'));
  if (t === 'inst' && isOp(v) && (v[0] === '_kw' || v[0] === '_as')) {
    const opts = () => [...REF_OPTS._kw.map((k) => ['kw:' + k, k]), ...keysOf('objects').map((k) => ['as:' + k, k])];
    return wrap(pick(opts, (v[0] === '_kw' ? 'kw:' : 'as:') + v[1], (s) => set(node, i, [s.startsWith('kw:') ? '_kw' : '_as', s.slice(3)])));
  }
  if ((ASSET_FIELD[t] || t === 'as') && (v == null || isOp(v) && v[0] === '_as')) return wrap(pick(assetOpts(t), v?.[1] ?? '', (s) => set(node, i, s ? ['_as', s] : null)));
  if (t === 'fn' && (v == null || isOp(v) && v[0] === '_fn')) return wrap(pick(() => keysOf('functions').map((k) => [k, k]), v?.[1] ?? '', (s) => set(node, i, ['_fn', s])));
  if (isOp(v)) return tag(block(v, ctx, true), { t: 'slot', node, i, spec: a });
  if (t === 'ref') {
    const opts = a.opts.length ? a.opts : REF_OPTS[node[0]];
    if (node[0] === 'fnc_g' && i === 1) return wrap(pick(() => keysOf('functions').map((k) => [k, k]), v, (s) => set(node, i, s)));
    return wrap(opts ? pick(opts.map((o) => [o, o.replace(/_/g, ' ')]), v, (s) => set(node, i, s)) : textIn(v ?? '', (s) => set(node, i, s), '.ref'));
  }
  if (t === 'bool' && (typeof v === 'boolean' || typeof v === 'number')) return wrap(pick([['1', 'true'], ['0', 'false']], v ? '1' : '0', (s) => set(node, i, s === '1')));
  if (t === 'key' && typeof v === 'number') return wrap(pick(Object.entries(KEYS).map(([c, n]) => [c, n]), String(v), (s) => set(node, i, Number(s))));
  if (t === 'col' && typeof v === 'number') return wrap(el('input.col', { type: 'color', value: bgr2hex(v), onchange: (e) => set(node, i, hex2bgr(e.target.value)) }));
  if (v !== null && typeof v === 'object') return wrap(textIn(JSON.stringify(v), (s) => { try { set(node, i, JSON.parse(s)); } catch { alert('Not valid JSON'); app.render(); } }, '.json'));
  const inp = textIn(showLit(v, t), (s) => set(node, i, parseLit(s, t)), typeof v === 'string' && t !== 'str' ? '.str' : '');
  if (v == null) inp.placeholder = 'undefined';
  return wrap(inp);
}

/** A statement list: blocks stacked vertically. get() returns (creating if needed) the array. */
function stmts(arr, get, ctx, cls = '') {
  const box = tag(el('div.stmts' + cls), { t: 'list', get });
  (arr ?? []).forEach((n, i) => box.append(tag(block(n, ctx, false), { t: 'stmt', arr, i })));
  return box;
}

function generic(info) {
  let s = (info.gml ?? info.name.replace(/^[a-z]+_/, '')).replace(/_/g, ' ');
  info.args.forEach((a, k) => { s += ` ${a.type === 'script' ? '' : a.name ? a.name + ' ' : ''}%${k + 1}`; });
  return s;
}

/** One block. asReporter: rendered inside an input slot. */
export function block(node, ctx, asReporter) {
  if (!isOp(node)) return el('div.blk.unknown', {}, el('div.b', {}, JSON.stringify(node)));
  const name = node[0], info = OPS.get(name), cat = info?.cat ?? 'sys';
  const shape = asReporter ? (BOOLISH.test(name) ? '.rep.bool' : '.rep') : '';
  const root = el(`div.blk${shape}.c-${CAT[cat]}`);
  if (!info) { root.classList.add('unknown'); root.append(el('div.b', {}, `${name}?`, textIn(JSON.stringify(node.slice(1)), () => {}, '.json'))); return root; }
  if (name === '_lv') { root.append(el('span.b', { title: 'Double-click to rename', ondblclick: () => { const s = prompt('Variable name', node[1]); if (s) set(node, 1, s); } }, node[1])); return root; }
  if (name === '_kw' || name === '_as' || name === '_fn') {
    const opts = name === '_kw' ? REF_OPTS._kw.map((k) => [k, k]) : () => (name === '_as' ? allAssetKeys() : keysOf('functions')).map((k) => [k, k]);
    root.append(el('span.b', {}, pick(opts, node[1], (s) => set(node, 1, s))));
    return root;
  }
  const hat = isHat(node), specs = info.args, last = hat ? node.length - 1 : node.length;
  const specAt = (k) => specs[k - 1] ?? (specs.at(-1)?.rest ? specs.at(-1) : A(''));
  let row = el('div.b' + (hat ? '.hat' : '')), used = new Set();
  root.append(row);
  const addArg = (k) => {
    const a = specAt(k);
    used.add(k);
    if (a.type === 'script') {
      const own = Array.isArray(node[k]) ? node[k] : null;
      root.append(el('div.mouth', {}, stmts(own, () => (Array.isArray(node[k]) ? node[k] : (node[k] = [])), ctx)));
      row = el('div.b.arm');
      root.append(row);
    } else if (a.rest) for (let j = k; j < last; j++) { used.add(j); row.append(slot(node, j, a, ctx)); }
    else if (k < last) row.append(slot(node, k, a, ctx));
  };
  const tpl = name === 'ctr_if' && node.length < 4 ? 'if %1 then %2' : LABELS[name] ?? generic(info);
  for (const tok of tpl.split(/(%\d+)/)) {
    if (/^%\d+$/.test(tok)) addArg(Number(tok.slice(1)));
    else if (tok.trim()) row.append(el('span.lbl', {}, tok.trim()));
  }
  for (let k = 1; k <= specs.length; k++) if (!used.has(k) && k < last) addArg(k);
  if (!hat) { // +/- for optional and repeated arguments
    const required = specs.filter((a) => !a.opt && !a.rest).length, next = specs[last - 1] ?? (specs.at(-1)?.rest ? specs.at(-1) : null);
    const lastRow = root.querySelectorAll(':scope > .b');
    const r = lastRow[lastRow.length - 1];
    if (next && (next.opt || next.rest) && next.type !== 'script') r.append(el('button.pm', { textContent: '+', title: `Add ${next.name || 'input'}`, onclick: () => { node.push(defaultFor(next, name)); commit(); } }));
    if (last - 1 > required && (specAt(last - 1).opt || specAt(last - 1).rest) && specAt(last - 1).type !== 'script') r.append(el('button.pm', { textContent: '−', title: 'Remove last input', onclick: () => { node.pop(); commit(); } }));
  }
  if (root.lastChild.classList.contains('arm') && !root.lastChild.childNodes.length && root.querySelector(':scope > .mouth')) root.lastChild.classList.add('foot');
  if (!hat && info.flags.includes('cap')) root.classList.add('cap');
  return root;
}

// ── canvas (one per script owner: "obj:<key>", "room:<key>", "fn:<key>", "global") ──
// Top-level entries are bare scripts (imports) or { x, y, script, loose } (see krpj.md "Script layout"). Objects,
// rooms and game start keep their loose stacks in the same list; a function keeps them in its `loose` list.
const scriptOf = (e) => (Array.isArray(e) ? e : e.script);
const xyOf = (e) => (!Array.isArray(e) && e.x != null ? [e.x, e.y] : null);
const isBody = (v) => Array.isArray(v) && v.every(Array.isArray);
function owner(id) {
  const p = app.project, key = id.slice(id.indexOf(':') + 1);
  if (id.startsWith('obj:')) return { list: p.objects[key].scripts, real: true };
  if (id.startsWith('room:')) return { list: p.rooms[key].scripts, real: true };
  if (id.startsWith('fn:')) { const fn = p.functions[key]; return { fn, list: fn.loose ?? [], fixed: true, label: () => `define ${key}(${fn.args.join(', ')})` }; }
  return { list: (p.global_init ??= []), label: () => 'when the game starts' };
}
/** Where loose stacks go (make: create a function's list). */
const looseList = (o, make) => (o.fn ? (make ? (o.fn.loose ??= []) : o.fn.loose ?? []) : o.list);
/** Loose entries never run: flagged, anything on a function's loose list, or (objects/rooms) a stack with no hat. */
const isLoose = (o, e) => o.fixed || e.loose === true || (o.real && !isHat(scriptOf(e)));
/** A hat's script, made if the hat has none (so blocks can be dropped under it). */
const hatBody = (hat) => (hat.length > 1 && isBody(hat.at(-1)) ? hat.at(-1) : (hat.push([]), hat.at(-1)));
export let zoom = 1;

/** The script canvas for an owner. Returns the pane content; call .layout() once it's in the document. */
export function canvas(id, info) {
  const o = owner(id), ctx = { id };
  const ws = el('div.ws', { style: { transform: `scale(${zoom})` } });
  const hatEl = (cls) => el('div.blk.c-' + cls, {}, el('div.b.hat', {}, el('span.lbl', {}, o.label())));
  if (o.fixed) {
    const t = tag(el('div.stack.top'), { t: 'top', i: 0 }), body = o.fn.body;
    t.append(hatEl('fnc'), stmts(body, () => body, ctx, '.hatbody'));
    t._pos = xyOf(o.fn);
    ws.append(t);
  }
  o.list.forEach((e, i) => {
    const s = scriptOf(e), loose = isLoose(o, e);
    const t = tag(el(loose ? 'div.stack.loose' : 'div.stack.top'), { t: loose ? 'loose' : 'top', i });
    if (loose) t.append(stmts(s, () => s, ctx));
    else if (o.real) t.append(block(s, ctx, false), stmts(s.length > 1 && isBody(s.at(-1)) ? s.at(-1) : [], () => hatBody(s), ctx, '.hatbody'));
    else t.append(hatEl('evt'), stmts(s, () => s, ctx, '.hatbody'));
    t._pos = xyOf(e);
    ws.append(t);
  });
  const size = el('div.ws-size', {}, ws);
  const pane = el('div.cv', { 'data-owner': id, oncontextmenu: (e) => menu(e, id) },
    info && el('div.cv-info', {}, info),
    !ws.children.length && el('p.cv-empty', {}, o.real ? 'Drag an event from Events to start, like “on create” or “on step”.' : 'Drag blocks here.'),
    el('div.cv-zoom', {},
      el('button', { textContent: '−', title: 'Zoom out', onclick: () => setZoom(zoom / 1.25) }),
      el('button', { textContent: '=', title: 'Reset zoom', onclick: () => setZoom(1) }),
      el('button', { textContent: '+', title: 'Zoom in', onclick: () => setZoom(zoom * 1.25) })),
    size);
  pane.addEventListener('pointerdown', (e) => down(e, pane, ws, id));
  pane.layout = () => {
    let y = 24;
    for (const t of ws.children) if (t._pos && t._pos[0] < 300) y = Math.max(y, t._pos[1] + t.offsetHeight + 24);
    let w = 0, h = 0;
    for (const t of ws.children) {
      let x = 24, ty = y;
      if (t._pos) [x, ty] = t._pos; else y += t.offsetHeight + 24;
      t.style.left = `${x}px`; t.style.top = `${ty}px`;
      w = Math.max(w, x + t.offsetWidth); h = Math.max(h, ty + t.offsetHeight);
    }
    size.style.width = `${(w + 600) * zoom}px`; size.style.height = `${(h + 400) * zoom}px`;
  };
  return pane;
}
function setZoom(z) { zoom = Math.min(2.5, Math.max(0.3, z)); app.render(); }

// ── palette ──
export const palOpts = { advanced: false, compat: false, filter: '' };
export function palette(view) {
  const box = el('div.blocks');
  const show = (o) => !(o.flags.includes('hidden') && !palOpts.advanced) && !(o.flags.includes('compat') && !palOpts.compat);
  const f = palOpts.filter.toLowerCase();
  const add = (node, label) => {
    if (f && !(label ?? node[0]).toLowerCase().includes(f) && !node[0].includes(f)) return;
    const b = block(node, {}, !isHat(node) && canReport(node) && reporterish(node[0]));
    box.append(tag(el('div.pal-blk', { title: node[0] }, b), { t: 'pal', make: () => structuredClone(node) }));
  };
  for (const [cat, label] of CATS) {
    box.append(el('h3', { id: `pc-${cat}`, style: { '--c': `var(--${CAT[cat]})` } }, label));
    if (cat === 'evt' && view !== 'object' && view !== 'room') {
      box.append(el('p.note', {}, view === 'global' ? 'Game start scripts run once, before the first room.' : view === 'function' ? 'A function has one script; it runs when called.' : ''));
      if (view === 'global') box.append(tag(el('div.pal-blk', {}, el('div.blk.c-evt', {}, el('div.b.hat', {}, el('span.lbl', {}, 'when the game starts')))), { t: 'pal', make: () => ({ pseudo: [] }) }));
      continue;
    }
    if (view === 'room' && cat === 'evt') { box.append(el('p.note', {}, 'Room creation code: “on create” runs after every instance is created.')); add(template('evt_create')); continue; }
    if (cat === 'fnc') {
      for (const k of keysOf('functions')) add(template('fnc_g', k), `call ${k}`);
      if (!keysOf('functions').length) box.append(el('p.note', {}, 'Add a function in the tree to call it here.'));
    }
    if (cat === 'var') for (const n of ['_lv', '_iv', '_ai', '_ar']) add(template(n));
    if (cat === 'ins') for (const n of ['_kw', '_as']) add(template(n));
    for (const o of OPCODES) if (OPS.get(o.name).cat === cat && show(o) && o.name !== 'fnc_g') {
      add(template(o.name));
      if (o.name === 'ctr_if') add(['ctr_if', true, [], []], 'if else');
    }
  }
  return box;
}

// ── dragging ──
let drag = null;
const ghostLayer = () => document.getElementById('drag-layer');
function down(e, pane, ws, id) {
  if (e.button !== 0 || e.target.closest('input, select, button, .cv-zoom')) return;
  const sx = e.clientX, sy = e.clientY;
  const blk = e.target.closest('.blk'), holder = blk && (refs.has(blk) ? blk : blk.parentElement);
  const topEl = e.target.closest('.stack.top');
  const src = holder && refs.has(holder) && refs.get(holder).t !== 'top' ? holder : (topEl && !blk?.closest('.stmts') ? topEl : null);
  if (!src) { // pan the canvas
    const l = pane.scrollLeft, t = pane.scrollTop;
    const mv = (m) => { pane.scrollLeft = l - (m.clientX - sx); pane.scrollTop = t - (m.clientY - sy); };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', () => removeEventListener('pointermove', mv), { once: true });
    return;
  }
  e.preventDefault();
  arm(e, () => pickUp(src, id), pane);
}
/** Palette blocks: pointerdown on the palette (wired by main.js). */
export function palDown(e) {
  const p = e.target.closest('.pal-blk');
  if (e.button !== 0 || !p) return;
  e.preventDefault();
  const pane = document.querySelector('.view:not([hidden]) .cv');
  if (!pane) return;
  const ref = refs.get(p);
  arm(e, () => { const node = ref.make(); return { nodes: node.pseudo ? null : [node], pseudo: node.pseudo, hat: isHat(node), els: [p.firstChild.cloneNode(true)], from: p, pal: true }; }, pane);
}
function arm(e, start, pane) {
  const sx = e.clientX, sy = e.clientY;
  const mv = (m) => {
    if (!drag) {
      if (Math.hypot(m.clientX - sx, m.clientY - sy) < 4) return;
      const p = start();
      const first = (p.from ?? p.els[0]).getBoundingClientRect();
      const ghost = el('div.ghost', { style: { transform: `scale(${zoom})` } }, p.els);
      ghostLayer().append(ghost);
      drag = { ...p, ghost, pane, ox: sx - first.left, oy: sy - first.top, over: null };
    }
    drag.ghost.style.left = `${m.clientX - drag.ox}px`; drag.ghost.style.top = `${m.clientY - drag.oy}px`;
    hover(m);
  };
  const up = (m) => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    if (drag) { hover(m); drop(); }
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
/** Detaches the dragged thing from the model and the DOM (dropping re-inserts it). */
function pickUp(src, id) {
  const ref = refs.get(src);
  if (ref.t === 'stmt') {
    const els = [src];
    for (let s = src.nextElementSibling; s; s = s.nextElementSibling) els.push(s);
    const first = src.getBoundingClientRect();
    return { nodes: ref.arr.splice(ref.i), els, from: { getBoundingClientRect: () => first }, id };
  }
  if (ref.t === 'slot') {
    const first = src.getBoundingClientRect(), v = ref.node[ref.i];
    ref.node[ref.i] = defaultFor(ref.spec, ref.node[0]);
    src.replaceWith(el('span.slot.emptied'));
    return { nodes: [v], els: [src], from: { getBoundingClientRect: () => first }, id };
  }
  const o = owner(id), first = src.getBoundingClientRect();
  if (ref.t === 'loose') { const l = looseList(o, true).splice(ref.i, 1)[0]; src.remove(); return { nodes: scriptOf(l), els: [src], from: { getBoundingClientRect: () => first }, id }; }
  // a top-level script
  if (o.fixed) { src.remove(); return { fixed: true, els: [src], from: { getBoundingClientRect: () => first }, id }; }
  const top = scriptOf(o.list.splice(ref.i, 1)[0]);
  src.remove();
  return o.real ? { nodes: [top], hat: true, els: [src], from: { getBoundingClientRect: () => first }, id } : { pseudo: top, els: [src], from: { getBoundingClientRect: () => first }, id };
}
const line = () => document.getElementById('drop-line');
function hover(m) {
  document.querySelector('.slot.hot')?.classList.remove('hot');
  line().hidden = true;
  drag.over = null;
  const g = drag.ghost.getBoundingClientRect();
  const one = drag.nodes?.length === 1 ? drag.nodes[0] : null;
  const reporter = one && canReport(one) && !drag.hat;
  const px = reporter ? g.left + 4 : g.left + 10, py = reporter ? g.top + g.height / 2 : g.top + 6;
  const hit = document.elementFromPoint(m.clientX, m.clientY);
  if (hit?.closest('.palette')) { drag.over = { t: 'delete' }; return; }
  if (drag.fixed || drag.hat || drag.pseudo) return;
  const at = document.elementFromPoint(px, py) ?? hit;
  if (!at || !drag.pane.contains(at)) return;
  const s = reporter && at.closest('.slot');
  if (s && refs.get(s)) { s.classList.add('hot'); drag.over = { t: 'slot', ref: refs.get(s) }; return; }
  // snap like Scratch: the nearest gap (above a block, or below the last one) to the dragged block's top-left corner
  let best = null, bd = 28;
  for (const list of drag.pane.querySelectorAll('.stmts')) {
    const lr = list.getBoundingClientRect();
    if (g.left < lr.left - 60 || g.left > lr.right + 30 || g.top < lr.top - 40 || g.top > lr.bottom + 40) continue;
    const kids = [...list.children].filter((c) => c.classList.contains('blk')).map((k) => k.getBoundingClientRect());
    const gaps = [...kids.map((r) => r.top), kids.length ? kids.at(-1).bottom : lr.top];
    gaps.forEach((y, idx) => {
      const dist = Math.hypot((g.left - lr.left) / 2, g.top - y);
      if (dist < bd) { bd = dist; best = { list, idx, y, x: lr.left }; }
    });
  }
  if (!best) return;
  Object.assign(line().style, { left: `${best.x}px`, top: `${best.y - 2}px`, width: '120px' });
  line().hidden = false;
  drag.over = { t: 'list', ref: refs.get(best.list), idx: best.idx };
}
function drop() {
  const d = drag; drag = null;
  const ws = d.pane.querySelector('.ws'), wr = ws.getBoundingClientRect(), gr = d.ghost.getBoundingClientRect();
  d.ghost.remove(); line().hidden = true;
  document.querySelector('.slot.hot')?.classList.remove('hot');
  const id = d.pane.dataset.owner;
  if (!id) return app.render();
  const x = Math.max(0, Math.round((gr.left - wr.left) / zoom)), y = Math.max(0, Math.round((gr.top - wr.top) / zoom));
  const o = owner(id), over = d.over;
  if (over?.t === 'delete' && !d.fixed) return d.pal ? app.render() : commit();
  if (over?.t === 'slot') {
    const old = over.ref.node[over.ref.i];
    over.ref.node[over.ref.i] = d.nodes[0];
    if (isOp(old) && !['_lv', '_as', '_kw', '_fn'].includes(old[0])) looseList(o, true).push({ x: x + 40, y: y + 40, loose: true, script: [old] });
  } else if (over?.t === 'list') over.ref.get().splice(over.idx, 0, ...d.nodes);
  else if (d.fixed) Object.assign(o.fn, { x, y });
  else if (d.hat || d.pseudo) {
    if (d.hat && !o.real || d.pseudo && o.real) { alert(o.real ? 'That block only works in Game start scripts.' : 'Events only work in objects and rooms.'); return app.render(); }
    o.list.push({ x, y, script: d.hat ? d.nodes[0] : d.pseudo });
  } else looseList(o, true).push({ x, y, loose: true, script: d.nodes });
  const loose = looseList(o);
  for (let i = loose.length; i--;) if (isLoose(o, loose[i]) && !scriptOf(loose[i]).length) loose.splice(i, 1);
  commit();
}

// ── context menu ──
function menu(e, id) {
  e.preventDefault();
  const b = e.target.closest('.blk'), holder = b && (refs.has(b) ? b : b.parentElement), ref = holder && refs.get(holder);
  const top = e.target.closest('.stack.top'), tref = top && refs.get(top), o = owner(id);
  const items = [];
  const looseAt = (nodes) => looseList(o, true).push({ x: null, y: null, loose: true, script: structuredClone(nodes) });
  if (ref?.t === 'stmt') {
    items.push(['Duplicate', () => { looseAt(ref.arr.slice(ref.i)); commit(); }], ['Delete block', () => { ref.arr.splice(ref.i, 1); commit(); }]);
  } else if (ref?.t === 'slot') {
    items.push(['Duplicate', () => { looseAt([ref.node[ref.i]]); commit(); }], ['Delete block', () => { ref.node[ref.i] = defaultFor(ref.spec, ref.node[0]); commit(); }]);
  } else if (tref && !o.fixed) {
    items.push(['Duplicate', () => { o.list.push(structuredClone(scriptOf(o.list[tref.i]))); commit(); }],
      ['Delete script', () => { o.list.splice(tref.i, 1); commit(); }]);
  }
  items.push(['Clean up blocks', () => {
    // Scripts go back to bare (auto-placed); loose stacks keep their wrapper so they stay loose.
    if (o.fn) o.fn.x = o.fn.y = null;
    const list = looseList(o);
    list.forEach((e, i) => { if (!Array.isArray(e)) list[i] = isLoose(o, e) ? { ...e, x: null, y: null } : e.script; });
    commit();
  }]);
  const m = document.getElementById('ctx');
  m.replaceChildren(...items.map(([label, fn]) => el('div', { textContent: label, onclick: () => { m.hidden = true; fn(); } })));
  Object.assign(m.style, { left: `${e.clientX}px`, top: `${e.clientY}px` });
  m.hidden = false;
}

export { coll };
