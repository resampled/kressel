// Code blocks: the palette (.w-code-list) and the script canvas (.w-code-box). Blocks are krpj script nodes
// (docs/krpj_opcodes.md); the canvas renders from `kreditorCode.stacks` and every drag edits that model, then re-renders.
// Inputs: each argument's type in the opcode table picks its slot (number, text, true/false, key, colour, dropdown,
// variable name, asset name, or a C-block mouth for `script`). Any non-mouth slot also takes a dropped reporter,
// which replaces the literal; dragging the reporter back out restores the slot's default.
// Classic script (no modules) so kreditor.html opens from file://. Needs opcodes.gen.js loaded first.
var kreditorCode = (function () {
  'use strict';
  const CATS = [['evt', 'Events'], ['ctr', 'Control'], ['mov', 'Movement'], ['drw', 'Drawing'], ['snd', 'Sound'],
    ['sen', 'Sensing'], ['opr', 'Operators'], ['var', 'Variables'], ['ins', 'Instances'], ['rom', 'Rooms'], ['cam', 'Camera'],
    ['fnc', 'Functions'], ['dat', 'Data'], ['sys', 'System']];
  const COLOUR = { ctr: 'ctl', drw: 'lks', _: 'var' }; // category -> .c-<colour> class, when they differ
  const MERGE = { lks: 'drw' }; // opcode prefix -> palette category, when they differ
  const colour = (cat) => 'c-' + (COLOUR[cat] || cat);

  // ── opcode metadata ──
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
  const ANY = { type: 'any', opts: [] };
  const UNARY = new Set(['opr_neg', 'opr_not', 'opr_bnot']);
  const OPS = new Map(OPCODES.map((o) => {
    let args = parseArgs(o.args);
    if (o.args === null && o.name.startsWith('opr_')) args = o.name === 'opr_cond' ? [ANY, ANY, ANY] : UNARY.has(o.name) ? [ANY] : [ANY, ANY];
    const gml = /`([a-z0-9_]+)/.exec(o.gml || '');
    return [o.name, { ...o, args, cat: o.name[0] === '_' ? (/^_(kw|as)$/.test(o.name) ? 'ins' : '_') : (MERGE[o.name.split('_')[0]] || o.name.split('_')[0]), gml: gml && gml[1] }];
  }));
  // ── dropdowns ──
  // MENUS: op -> { argument index: options }; TYPE_MENUS: slot type -> options (backtick options in the opcode table win).
  // Options are values (labelled through OPT_LABELS, else underscores read as spaces) or [value, label] pairs: a value not in
  // the list (e.g. from an import) falls back to a plain input. A function instead lists names when the menu opens, and
  // the menu also takes a typed name: variables come from the scripts, assets from `sources` (filled by the editor).
  const KW = ['self', 'other', 'all', 'noone', 'global'];
  const BUILTIN = new Set(BUILTIN_VARS); // built-in variables (x, room...), from opcodes.gen.js: not the user's own
  const KEY_NAMES = { 0: 'no key', 1: 'any key', 8: 'backspace', 9: 'tab', 13: 'enter', 16: 'shift', 17: 'control', 18: 'alt', 27: 'escape',
    32: 'space', 37: 'left arrow', 38: 'up arrow', 39: 'right arrow', 40: 'down arrow' };
  for (let c = 48; c <= 90; c++) if (c <= 57 || c >= 65) KEY_NAMES[c] = String.fromCharCode(c);
  for (let f = 1; f <= 12; f++) KEY_NAMES[111 + f] = 'F' + f;
  const OPT_LABELS = { string: 'text', real: 'number', h: 'horizontal', v: 'vertical', restart: 'this (restart)', rgb: 'RGB', hsv: 'HSV' };
  const MB = [[1, 'left'], [2, 'right'], [3, 'middle']];
  const TRIG = ['sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan'];
  const GP = ['A / cross', 'B / circle', 'X / square', 'Y / triangle', 'left shoulder', 'right shoulder', 'left trigger', 'right trigger',
    'select', 'start', 'left stick', 'right stick', 'pad up', 'pad down', 'pad left', 'pad right'].map((l, k) => [32769 + k, l]);
  const MENUS = {
    evt_key: { 1: ['pressed', 'held', 'released'] },
    evt_mouse: { 1: ['left_pressed', 'left_held', 'left_released', 'right_pressed', 'right_held', 'right_released', 'middle_pressed',
      'middle_held', 'middle_released', 'none', 'enter', 'leave', 'wheel_up', 'wheel_down', 'global_left_pressed', 'global_left_held', 'global_left_released'] },
    var_change: { 1: ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '??'] },
    opr_mathop: { 1: ['abs', 'sign', 'round', 'floor', 'ceil', 'frac', 'sqrt', 'sqr', 'exp', 'ln', 'log2', 'log10'] },
    opr_trig: { 1: TRIG }, opr_dtrig: { 1: TRIG },
    opr_is_type: { 1: ['real', 'string', 'array', 'struct', 'undefined', 'bool', 'method', 'numeric', 'int64', 'ptr'] },
    _kw: { 1: KW },
    sen_mouse_held: { 1: MB }, sen_mouse_pressed: { 1: MB }, sen_mouse_released: { 1: MB }, sen_gamepad_button: { 3: GP },
    drw_set_align: { 2: [[0, 'left / top'], [1, 'centre / middle'], [2, 'right / bottom']] },
    mov_path_start: { 3: [[0, 'stop'], [1, 'restart'], [2, 'continue'], [3, 'reverse']] },
  };
  const NAME_AT = { _lv: 1, _iv: 2, var_local: 1, var_static: 1, var_globalvar: 1, ctr_for_each: 1 }; // op -> variable name index
  for (const [op, k] of Object.entries(NAME_AT)) (MENUS[op] ||= {})[k] = varMenu;
  const TYPE_MENUS = { bool: [[true, 'true'], [false, 'false']], key: Object.entries(KEY_NAMES).map(([c, l]) => [Number(c), l]) };
  const sources = {}; // asset type -> () => [name, ...], set by the editor
  const assets = (t) => (sources[t] ? sources[t]() : []);
  const items = (l) => typeof l === 'function' ? l().map((n) => Array.isArray(n) ? n : [n, n]) : l.map((o) => Array.isArray(o) ? o : [o, OPT_LABELS[o] || o.replace(/_/g, ' ')]);
  // Palette starting values, when the per-type default (0, true, '', white...) would be a poor start: op -> { index: value }.
  const X = ['_lv', 'x'], Y = ['_lv', 'y'], HI = 'Hello!';
  const DEFAULTS = {
    snd_play: { 3: false }, snd_gain: { 2: 1 }, snd_pitch: { 2: 1 }, drw_rect: { 5: false }, drw_circle: { 3: 16, 4: false },
    drw_sprite: { 3: X, 4: Y }, drw_sprite_ext: { 3: X, 4: Y, 5: 1, 6: 1, 9: 1 }, drw_text: { 3: HI },
    drw_text_transformed: { 3: HI, 4: 1, 5: 1 }, drw_set_alpha: { 1: 1 }, drw_make_colour: { 2: 255, 3: 255, 4: 255 },
    sen_place_meeting: { 1: X, 2: Y }, sen_instance_place: { 1: X, 2: Y }, sen_place_free: { 1: X, 2: Y },
    sen_mouse_held: { 1: 1 }, sen_mouse_pressed: { 1: 1 }, sen_mouse_released: { 1: 1 }, sen_gamepad_button: { 3: 32769 },
    ctr_repeat: { 1: 10 }, ctr_alarm_set: { 2: 30 }, mov_motion_set: { 2: 4 }, mov_towards_point: { 3: 4 },
    opr_random: { 1: 1 }, opr_irandom: { 1: 10 }, opr_random_range: { 2: 1 }, opr_irandom_range: { 1: 1, 2: 10 },
    opr_clamp: { 3: 1 }, opr_lerp: { 2: 1, 3: 0.5 }, var_local: { 1: 'temp', 2: 0 }, var_arr_delete: { 3: 1 },
    ctr_for_each: { 1: 'item' },
  };

  // %n = argument n (node[n]); `script` arguments become C-block mouths. Unlisted opcodes get a label generated from
  // their GML name, which is fine for (hidden) blocks; every block shown by default should read as plain English here.
  const LABELS = {
    evt_create: 'on create', evt_destroy: 'on destroy', evt_cleanup: 'on clean up', evt_step: 'on step', evt_step_begin: 'on begin step',
    evt_step_end: 'on end step', evt_alarm: 'on alarm %1', evt_draw: 'on draw', evt_draw_begin: 'on begin draw', evt_draw_end: 'on end draw',
    evt_drawgui: 'on draw GUI', evt_drawgui_begin: 'on begin draw GUI', evt_drawgui_end: 'on end draw GUI', evt_collision: 'on touching %1',
    evt_key: 'on key %2 %1', evt_mouse: 'on mouse %1', evt_user: 'on user event %1', evt_room_start: 'on room start', evt_room_end: 'on room end',
    evt_game_start: 'on game start', evt_game_end: 'on game end', evt_animation_end: 'on animation end', evt_path_end: 'on path end',
    evt_outside_room: 'on leaving the room', evt_intersect_boundary: 'on touching the room edge',
    ctr_if: 'if %1 then %2 else %3', ctr_repeat: 'repeat %1 %2', ctr_while: 'while %1 %2', ctr_do_until: 'do %1 until %2',
    ctr_for: 'for %1 while %2 each time %3 do %4', ctr_for_each: 'for each %1 in %2 %3', ctr_switch: 'switch %1 %2', ctr_case: 'case %1',
    ctr_default: 'default', ctr_break: 'break', ctr_continue: 'continue', ctr_with: 'run as each %1 %2', ctr_exit: 'stop this event',
    ctr_return: 'return %1', ctr_alarm_set: 'set alarm %1 to %2 steps', ctr_alarm_get: 'steps left on alarm %1',
    var_set: 'set %1 to %2', var_change: 'change %2 by %1 %3', var_inc: 'increase %1', var_dec: 'decrease %1',
    var_local: 'make temporary variable %1 = %2', fnc_g: 'run function %1 %2', fnc_m: 'call method %1 %2',
    opr_add: '%1 + %2', opr_sub: '%1 − %2', opr_mul: '%1 × %2', opr_div: '%1 ÷ %2', opr_idiv: '%1 div %2', opr_mod: '%1 mod %2',
    opr_neg: '− %1', opr_eq: '%1 = %2', opr_neq: '%1 ≠ %2', opr_lt: '%1 < %2', opr_lte: '%1 ≤ %2', opr_gt: '%1 > %2', opr_gte: '%1 ≥ %2',
    opr_and: '%1 and %2', opr_or: '%1 or %2', opr_xor: '%1 xor %2', opr_not: 'not %1', opr_cond: 'if %1 then %2 else %3',
    opr_nullish: '%1 ?? %2', opr_band: '%1 & %2', opr_bor: '%1 | %2', opr_bxor: '%1 ^ %2', opr_bnot: '~ %1', opr_shl: '%1 << %2',
    opr_shr: '%1 >> %2', opr_random:'random number from 0 to %1', opr_irandom: 'random whole number from 0 to %1',
    opr_random_range: 'random number from %1 to %2', opr_irandom_range: 'random whole number from %1 to %2',
    opr_choose: 'pick one of %1', opr_randomize: 'use a new random seed', opr_string: '%1 as text', opr_real: '%1 as number',
    opr_point_direction: 'direction from x %1 y %2 to x %3 y %4', opr_point_distance: 'distance from x %1 y %2 to x %3 y %4',
    opr_lengthdir: '%1 of moving %2 toward %3°', opr_mathop: '%1 of %2', opr_dtrig: '%1 of %2°', opr_aggregate: '%1 of %2',
    opr_clamp: 'limit %1 between %2 and %3', opr_lerp: 'blend %1 to %2 by %3',
    opr_str_length: 'length of %1', opr_str_char_at: 'letter %2 of %1', opr_str_copy: '%3 letters of %1 from %2',
    opr_str_pos: 'position of %1 in %2', opr_str_replace: 'replace %1 %3 in %2 with %4', opr_str_case: '%2 in %1 case',
    _lv: '%1', _kw: '%1', _as: '%1', _fn: 'function %1', _iv: '%1 . %2', _ar: 'array %1', _ai: '%1 [ %2 ]',
    var_arr_length: 'length of %1', var_arr_push: 'add %2 to the end of %1', var_arr_delete: 'delete %3 items of %1 from position %2',
    var_arr_contains: '%1 contains %2?',
    sen_key_held: 'key %1 held?', sen_key_pressed: 'key %1 pressed?', sen_key_released: 'key %1 released?',
    sen_mouse_held: 'mouse %1 held?', sen_mouse_pressed: 'mouse %1 pressed?', sen_mouse_released: 'mouse %1 released?',
    sen_mouse_wheel: 'mouse wheel %1?', sen_gamepad_button: 'gamepad %2 button %3 %1?',
    sen_place_meeting: 'touching %3 at x %1 y %2?', sen_instance_place: '%3 touched at x %1 y %2',
    sen_place_free: 'no solids at x %1 y %2?', sen_distance_to_object: 'distance to %1',
    ins_create_layer: 'create %4 at x %1 y %2 on layer %3', ins_create_depth: 'create %4 at x %1 y %2 depth %3', ins_destroy: 'destroy %1',
    ins_exists: '%1 exists?', ins_number: 'number of %1', ins_event_inherited: 'run parent event', ins_nearest: 'nearest %3 to x %1 y %2',
    mov_motion_set: 'move at speed %2 toward %1°', mov_motion_add: 'push toward %1° by %2', mov_wrap: 'wrap around room h %1 v %2 margin %3',
    mov_towards_point: 'move toward x %1 y %2 at speed %3',
    lks_sprite_info: '%1 of %2',
    snd_play: 'play sound %1 loop %3 priority %2', snd_stop: 'stop sound %1', snd_stop_all: 'stop all sounds', snd_pause: '%1 sound %2',
    snd_is: 'sound %2 %1?', snd_gain: 'set volume of %1 to %2 over %3 ms', snd_pitch: 'set pitch of %1 to %2',
    drw_self: 'draw myself', drw_text: 'draw text %3 at x %1 y %2', drw_set_font: 'set font %1', drw_set_colour: 'set colour %1',
    drw_sprite: 'draw %1 frame %2 at x %3 y %4', drw_sprite_ext: 'draw %1 frame %2 at x %3 y %4 scale %5 %6 angle %7 tint %8 opacity %9',
    drw_text_transformed: 'draw text %3 at x %1 y %2 scale %4 %5 angle %6', drw_set_alpha: 'set opacity to %1 (0 to 1)',
    drw_set_align: 'align text %1 %2', drw_make_colour: '%1 colour %2 %3 %4',
    drw_rect: 'draw rectangle from x %1 y %2 to x %3 y %4 outline only %5', drw_circle: 'draw circle at x %1 y %2 radius %3 outline only %4',
    drw_line: 'draw line from x %1 y %2 to x %3 y %4 width %5',
    rom_goto: 'go to room %1', rom_change: 'go to %1 room', rom_layer_set_visible: 'set layer %1 visible %2',
    cam_get: 'camera %2 %1', cam_set_pos: 'move camera %1 to x %2 y %3', cam_fullscreen_set: 'set fullscreen %1',
    dat_ini_open: 'open save file %1', dat_ini_close: 'close save file', dat_file_exists: 'file %1 exists?',
    dat_ini_read: 'read %1 from save section %2 key %3 or %4', dat_ini_write: 'write %1 %4 to save section %2 key %3',
    sys_log: 'log %1', sys_game_end: 'end game', sys_game_restart: 'restart game',
  };
  const generic = (info) => info.args.reduce((s, a, k) => `${s} ${a.type !== 'script' && a.name ? a.name + ' ' : ''}%${k + 1}`,
    (info.gml || info.name.replace(/^[a-z]+_/, '')).replace(/_/g, ' '));

  const isOp = (n) => Array.isArray(n) && typeof n[0] === 'string';
  const isHat = (n) => isOp(n) && n[0].startsWith('evt_');
  const isBody = (v) => Array.isArray(v) && v.every(Array.isArray);
  const STMT_ONLY = new Set(['var_set', 'var_change', 'var_local', 'var_static', 'var_globalvar', 'var_delete', 'ctr_case', 'ctr_default',
    'ctr_break', 'ctr_continue', 'ctr_exit', 'ctr_return', 'ctr_throw']);
  const BOOLISH = /^opr_(eq|neq|lt|lte|gt|gte|and|or|xor|not)$|^sen_(key|place|position|mouse_(held|pressed|released))|_exists$|_is_|^ins_is/;
  const REPORTERISH = /^(opr|_|sen|lks)|_get|_is|exists|number|_find|nearest|furthest|_info|_size|length|_count|_timer|_now|_date|_make_colour|_merge_colour|_id$/;
  /** Drawn (and dropped) as a reporter rather than a stack block. */
  const isReporter = (n) => isOp(n) && !isHat(n) && !STMT_ONLY.has(n[0]) && REPORTERISH.test(n[0]) &&
    !((OPS.get(n[0]) || {}).args || []).some((a) => a.type === 'script');
  const ASSET_TYPES = new Set(['obj', 'spr', 'snd', 'fnt', 'room', 'path', 'shd', 'as']);

  function defaultFor(a, op) {
    switch (a.type) {
      case 'script': return [];
      case 'bool': return true;
      case 'num': case 'ds': return 0;
      case 'any': return op === 'ctr_if' || op === 'ctr_while' ? true : 0;
      case 'str': return '';
      case 'col': return 16777215;
      case 'key': return 32;
      case 'var': return ['_lv', 'myvar'];
      case 'inst': return ['_kw', 'self'];
      case 'ref': {
        const m = a.opts.length ? a.opts : (MENUS[op] || {})[1];
        return op === '_lv' ? 'myvar' : m && typeof m !== 'function' ? items(m)[0][0] : '';
      }
      case 'layer': return 'Instances';
      case 'arr': return ['_lv', 'myarray'];
      case 'struct': return {};
      default: return ASSET_TYPES.has(a.type) ? ['_as', ''] : 0;
    }
  }
  /** A new node for the palette: required arguments filled with defaults (plus an empty body for hats). */
  function template(op) {
    const n = [op];
    for (const a of OPS.get(op).args) { if (a.opt) break; n.push(defaultFor(a, op)); if (a.rest) break; }
    for (const [k, v] of Object.entries(DEFAULTS[op] || {})) n[k] = structuredClone(v); // may also fill an optional argument
    if (isHat(n)) n.push([]);
    return n;
  }

  // ── literals ──
  const NUM = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
  function parseLit(s, type) {
    if (type === 'str') return s;
    if (s.length > 1 && s[0] === '"' && s.endsWith('"')) return s.slice(1, -1);
    if (NUM.test(s.trim())) return Number(s);
    if (type === 'any' && (s === 'true' || s === 'false')) return s === 'true';
    return s; // text in a number slot stays a string: GML decides what happens at runtime
  }
  const showLit = (v, type) => v == null ? '' : typeof v === 'string' && type !== 'str' && NUM.test(v.trim()) ? `"${v}"` : String(v);
  const bgr2hex = (c) => '#' + [c & 255, (c >> 8) & 255, (c >> 16) & 255].map((x) => x.toString(16).padStart(2, '0')).join('');
  const hex2bgr = (h) => { const n = parseInt(h.slice(1), 16); return ((n & 255) << 16) | (n & 0xff00) | (n >> 16); };

  // ── rendering ──
  const refs = new WeakMap(); // element -> { kind: 'stmt'|'slot'|'list'|'pal', ... }
  const tag = (e, ref) => (refs.set(e, ref), e);
  function h(name, cls, ...kids) {
    const e = document.createElement(name);
    if (cls) e.className = cls;
    e.append(...kids.filter((k) => k != null));
    return e;
  }
  const fit = (inp) => { inp.style.width = `calc(${Math.max(1, inp.value.length)}ch + 8px)`; };
  function text(value, onSet) {
    const inp = h('input');
    inp.value = value; inp.spellcheck = false;
    inp.oninput = () => fit(inp);
    inp.onchange = () => onSet(inp.value);
    fit(inp);
    return inp;
  }
  /** A dropdown slot: shows the chosen option and opens the shared popup on click. Name lists aren't built until then. */
  function menu(list, value, onSet, placeholder) {
    const it = typeof list !== 'function' && items(list).find(([x]) => x === value);
    const b = h('span', 'dd', it ? it[1] : String(value ?? '') || placeholder || ' ');
    b.onclick = () => popup(b, list, value, onSet);
    if (list === varMenu && BUILTIN.has(value)) { b.classList.add('builtin'); b.title = 'built-in variable'; }
    return b;
  }

  // One popup for every dropdown: a filter box (which also takes a new name) over the matching options.
  let pop = null;
  const closePopup = () => { if (pop) pop.remove(); pop = null; };
  function popup(anchor, list, value, onSet, search = true, make = 'use') { // make: label for a typed new name
    closePopup();
    const free = typeof list === 'function', all = items(list), filter = h('input'), ul = h('div', 'dd-list');
    filter.spellcheck = false; filter.placeholder = free ? 'search or type a name' : 'search';
    let shown = [], sel = 0;
    const choose = (v) => { closePopup(); if (v !== value) { onSet(v); changed(); } };
    const draw = () => {
      ul.replaceChildren(...shown.map(([label, act, cur], k) => {
        const d = h('div', 'dd-it' + (cur ? ' cur' : '') + (k === sel ? ' sel' : ''), label);
        d.onpointerdown = (e) => { e.preventDefault(); act(); };
        return d;
      }));
      if (ul.children[sel]) ul.children[sel].scrollIntoView({ block: 'nearest' });
    };
    const fill = () => {
      const typed = filter.value.trim(), q = typed.toLowerCase();
      shown = all.filter(([, l]) => String(l).toLowerCase().includes(q)).map(([x, l]) => [l, () => choose(x), x === value]);
      if (free && typed && !all.some(([x]) => x === typed)) {
        shown.unshift([`${make} "${typed}"`, () => choose(typed)]);
        if (list === varMenu && value && !BUILTIN.has(value)) shown.push([`rename "${value}" to "${typed}" everywhere`, () => { closePopup(); renameVar(value, typed); changed(); }]);
      }
      sel = Math.max(0, typed ? 0 : shown.findIndex((s) => s[2]));
      draw();
    };
    filter.oninput = fill;
    const keys = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % (shown.length || 1); draw(); }
      else if (e.key === 'Enter' && shown[sel]) shown[sel][1]();
      else if (e.key === 'Escape') closePopup();
      else return;
      e.preventDefault();
    };
    pop = h('div', 'dd-pop', search ? filter : null, ul);
    pop.tabIndex = -1; pop.onkeydown = keys; // arrows, Enter and Escape work with or without the search box
    document.body.append(pop);
    fill();
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 4) + 'px';
    pop.style.top = (r.bottom + pop.offsetHeight + 4 > innerHeight ? r.top - pop.offsetHeight - 2 : r.bottom + 2) + 'px';
    (search ? filter : pop).focus();
  }

  /** Calls fn(node, k) for every variable name in the scripts (node[k]). */
  function eachName(fn) {
    const walk = (n) => {
      if (!Array.isArray(n)) return;
      const k = NAME_AT[n[0]];
      if (k && typeof n[k] === 'string') fn(n, k);
      n.forEach(walk);
    };
    for (const st of stacks) walk(st.script);
  }
  /** The user's own variable names in the scripts (not built-ins), sorted. */
  function knownVars() { const s = new Set(); eachName((n, k) => BUILTIN.has(n[k]) || s.add(n[k])); return [...s].sort(); }
  /** Variable dropdowns: the user's variables, then the built-ins. */
  function varMenu() { return [...knownVars(), ...BUILTIN_VARS.map((b) => [b, b + ' (built-in)'])]; }
  function renameVar(from, to) { eachName((n, k) => { if (n[k] === from) n[k] = to; }); }

  /** The input for node[i]: an editor for a literal, or the reporter block sitting in it. */
  function slot(node, i, a) {
    const v = node[i], t = a.type, set = (x) => { node[i] = x; notify(); };
    const wrap = (c, cls) => tag(h('span', 'slot ' + (cls || 'in-' + t), c), { kind: 'slot', node, i, spec: a });
    if (isOp(v)) {
      if (v[0] === '_lv' && t === 'var') return wrap(menu(varMenu, v[1], (s) => set(['_lv', s])), 'in-var');
      if ((v[0] === '_kw' || v[0] === '_as') && (t === 'inst' || ASSET_TYPES.has(t))) {
        const list = t === 'inst' ? () => KW.concat(assets('obj')) : () => assets(t);
        return wrap(menu(list, v[1], (s) => set([t === 'inst' && KW.includes(s) ? '_kw' : '_as', s]), t), 'in-asset');
      }
      return tag(block(v, true), { kind: 'slot', node, i, spec: a });
    }
    const opts = a.opts.length ? a.opts : (MENUS[node[0]] || {})[i] || TYPE_MENUS[t];
    if (typeof opts === 'function') return wrap(menu(opts, v == null ? '' : String(v), set), 'in-ref');
    if (opts && items(opts).some(([x]) => x === v)) return wrap(menu(opts, v, set), 'in-ref');
    if (t === 'ref') return wrap(text(v == null ? '' : String(v), set), 'in-ref');
    if (t === 'col' && typeof v === 'number') {
      const c = h('input'); c.type = 'color'; c.value = bgr2hex(v); c.onchange = () => set(hex2bgr(c.value));
      return wrap(c);
    }
    if (v !== null && typeof v === 'object') return wrap(text(JSON.stringify(v), (s) => { try { set(JSON.parse(s)); } catch (e) { render(); } }), 'in-json');
    return wrap(text(showLit(v, t), (s) => set(parseLit(s, t))), t === 'num' || t === 'str' ? 'in-' + t : 'in-any');
  }

  /** One block. asRep: drawn as a reporter (round, or pointed for booleans). */
  function block(node, asRep) {
    const op = node[0], info = OPS.get(op);
    if (!info) return h('div', 'blk cmd unknown', h('div', 'c', 'unknown opcode: ' + op)); // fail loudly
    const hat = isHat(node), specs = info.args;
    if (hat && !(node.length > 1 && isBody(node[node.length - 1]))) node.push([]);
    const end = hat ? node.length - 1 : node.length;
    const specAt = (k) => specs[k - 1] || (specs.length && specs[specs.length - 1].rest ? specs[specs.length - 1] : ANY);
    const el = h('div', `blk ${hat ? 'hat' : asRep ? (BOOLISH.test(op) ? 'rep bool' : 'rep') : 'cmd'} ${colour(info.cat)}`);
    let row = h('div', hat ? 'ch' : 'c');
    el.append(row);
    const mouth = (list) => { el.append(h('div', 'cm', h('div', 'cs'), stack(list))); el.append(row = h('div', 'c')); };
    const used = new Set();
    const arg = (k) => {
      const a = specAt(k);
      used.add(k);
      if (a.type === 'script') { if (k < end) mouth(isBody(node[k]) ? node[k] : (node[k] = [])); }
      else if (a.rest) for (let j = k; j < end; j++) { used.add(j); row.append(slot(node, j, a)); }
      else if (k < end) row.append(slot(node, k, a));
    };
    const tpl = op === 'ctr_if' && end < 4 ? 'if %1 then %2' : LABELS[op] || generic(info);
    for (const tok of tpl.split(/(%\d+)/)) {
      if (/^%\d+$/.test(tok)) arg(Number(tok.slice(1)));
      else if (tok.trim()) row.append(h('span', 'lbl', tok.trim()));
    }
    for (let k = 1; k < end; k++) if (!used.has(k)) arg(k);
    if (!hat) { // + / − for optional and repeated inputs
      const target = row.childNodes.length ? row : el.firstChild;
      const required = specs.filter((a) => !a.opt && !a.rest).length, next = specs[end - 1] || (specAt(end).rest ? specAt(end) : null);
      const btn = (label, fn) => { const b = h('button', 'pm', label); b.onclick = () => { fn(); changed(); }; target.append(b); };
      if (next && (next.opt || next.rest) && next.type !== 'script') btn('+', () => node.push(defaultFor(next, op)));
      if (end - 1 > required && specAt(end - 1).type !== 'script') btn('−', () => node.pop());
    }
    if (hat) mouth(node[node.length - 1]);
    if (!row.childNodes.length) row.className = 'cu';
    return el;
  }

  /** A vertical list of statements. top: the canvas stack it belongs to (top-level only). */
  function stack(list, top) {
    const s = tag(h('div', top ? 'stk top' : 'stk'), { kind: 'list', list, top });
    list.forEach((n, i) => s.append(tag(block(n, top && list.length === 1 && isReporter(n)), { kind: 'stmt', list, i })));
    return s;
  }

  // ── canvas ──
  const stacks = []; // [{ x, y, script: [node, ...] }]: a krpj "placed" script; a hat stack is [hatNode]
  let box, list, line, palVars = '';
  const palOpts = { hidden: false, compat: false }; // also list opcodes with these flags in the palette
  const visible = (o) => Object.keys(palOpts).every((f) => palOpts[f] || !o.flags.includes(f));
  function render() {
    closePopup();
    box.replaceChildren(...stacks.map((st) => {
      const s = stack(st.script, st);
      if (st.body) s.classList.add('body');
      s.style.left = st.x + 'px'; s.style.top = st.y + 'px';
      return s;
    }));
    if (knownVars().join('\n') !== palVars) palette(); // the palette has a reporter per variable
  }
  /** After an edit: tell the editor (api.onchange), which records an undo step. changed() also redraws. */
  const notify = () => { if (api.onchange) api.onchange(); };
  function changed() { render(); notify(); }

  // Section headings are sticky at both edges (CSS), offset by their index: headings of sections scrolled past pile up
  // at the top of the list in order, those still below pile up at the bottom. Clicking one scrolls to its section.
  function palette() {
    const out = [];
    const show = visible, vars = knownVars();
    palVars = vars.join('\n');
    for (const [cat, label] of CATS) {
      const head = h('h3', colour(cat), label), i = out.filter((e) => e.tagName === 'H3').length;
      head.style.setProperty('--i', i);
      head.style.setProperty('--j', CATS.length - 1 - i);
      head.onclick = () => {
        const first = head.nextElementSibling;
        list.scrollTo({ top: first.offsetTop - (i + 1) * head.offsetHeight - 6, behavior: 'smooth' });
      };
      out.push(head);
      const nodes = [];
      if (cat === 'var') nodes.push(...(vars.length ? vars : ['myvar']).map((v) => ['_lv', v]), ['_iv', ['_kw', 'global'], 'myvar'], template('_ai'), template('_ar'));
      for (const o of OPCODES) {
        if (OPS.get(o.name).cat !== cat || !show(o)) continue;
        nodes.push(template(o.name));
        if (o.name === 'ctr_if') nodes.push(['ctr_if', true, [], []]);
      }
      for (const n of nodes) {
        const el = tag(h('div', 'pal', block(n, isReporter(n))), { kind: 'pal', node: n }), gml = OPS.get(n[0]).gml;
        if (gml && gml.length > 1) el.title = 'GameMaker: ' + gml; // for users coming from GML (operators' `a + b` parse to 'a')
        out.push(el);
      }
    }
    for (const [f, label] of [['hidden', 'Show advanced blocks'],['compat', 'Show GameMaker compatibility blocks']]) {
      const cb = h('input');
      cb.type = 'checkbox'; cb.checked = palOpts[f];
      cb.onchange = () => { palOpts[f] = cb.checked; palette(); };
      out.push(h('label', 'pal-opt', cb, label));
    }
    list.replaceChildren(...out);
  }

  // ── dragging ──
  let drag = null;
  function down(e) {
    if (e.button !== 0) return;
    const pal = e.target.closest('.pal');
    if (pal && e.target === pal && e.offsetY >= pal.clientHeight) return; // own horizontal scrollbar
    if (!pal && e.target.closest('input, select, button, .dd')) return;
    let src = pal ? null : e.target.closest('.blk');
    while (src && !refs.has(src)) src = src.parentElement.closest('.blk');
    if (!pal && !src) { if (e.target.closest('.w-code-box')) pan(e); return; }
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const move = (m) => {
      if (!drag) {
        if (Math.hypot(m.clientX - sx, m.clientY - sy) < 4) return;
        drag = pal ? { nodes: [structuredClone(refs.get(pal).node)], els: [pal.firstChild.cloneNode(true)], rect: pal.firstChild.getBoundingClientRect() } : pickUp(src);
        drag.ghost = h('div', 'ghost stk', ...drag.els);
        drag.ox = sx - drag.rect.left; drag.oy = sy - drag.rect.top;
        drag.rep = drag.nodes.length === 1 && isReporter(drag.nodes[0]);
        document.body.append(drag.ghost);
      }
      drag.ghost.style.left = m.clientX - drag.ox + 'px'; drag.ghost.style.top = m.clientY - drag.oy + 'px';
      hover(m);
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (drag) drop(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
  function pan(e) {
    const sx = e.clientX + box.scrollLeft, sy = e.clientY + box.scrollTop;
    const move = (m) => { box.scrollLeft = sx - m.clientX; box.scrollTop = sy - m.clientY; };
    addEventListener('pointermove', move);
    addEventListener('pointerup', () => removeEventListener('pointermove', move), { once: true });
  }
  /** Takes the dragged block out of the model and the DOM: a statement brings the blocks below it along. */
  function pickUp(src) {
    const ref = refs.get(src), rect = src.getBoundingClientRect();
    if (ref.kind === 'slot') {
      const v = ref.node[ref.i];
      ref.node[ref.i] = defaultFor(ref.spec, ref.node[0]);
      src.replaceWith(h('span', 'slot in-any'));
      return { nodes: [v], els: [src], rect };
    }
    const els = [];
    for (let s = src; s; s = s.nextElementSibling) els.push(s);
    return { nodes: ref.list.splice(ref.i), els, rect };
  }
  function hover(m) {
    const hot = box.querySelector('.hot');
    if (hot) hot.classList.remove('hot');
    line.hidden = true;
    drag.over = null;
    const lr = list.getBoundingClientRect(), g = drag.ghost.getBoundingClientRect();
    if (m.clientX < lr.right && m.clientX > lr.left && m.clientY > lr.top && m.clientY < lr.bottom) { drag.over = { kind: 'delete' }; return; }
    if (drag.rep) { // into the innermost input under the reporter's left edge
      let t = document.elementFromPoint(g.left + 3, g.top + g.height / 2);
      while (t && box.contains(t) && !(refs.get(t) || {}).node) t = t.parentElement;
      if (t && box.contains(t)) { t.classList.add('hot'); drag.over = refs.get(t); }
      return;
    }
    if (isHat(drag.nodes[0])) return;
    // the gap (above a block, or after the last one) nearest to the dragged block's top-left corner
    let best = null, bd = 28;
    for (const s of box.querySelectorAll('.stk')) {
      const ref = refs.get(s);
      if (isHat(ref.list[0]) || (ref.top && s.firstChild && s.firstChild.classList.contains('rep'))) continue;
      const r = s.getBoundingClientRect();
      if (g.left < r.left - 60 || g.left > r.right + 30 || g.top < r.top - 40 || g.top > r.bottom + 40) continue;
      const kids = [...s.children].map((k) => k.getBoundingClientRect());
      const gaps = kids.map((k) => k.top).concat(kids.length ? kids[kids.length - 1].bottom : r.top);
      gaps.forEach((y, idx) => {
        const d = Math.hypot((g.left - r.left) / 2, g.top - y);
        if (d < bd) { bd = d; best = { kind: 'list', list: ref.list, top: ref.top, idx, x: r.left, y }; }
      });
    }
    if (!best) return;
    line.style.left = best.x + 'px'; line.style.top = best.y - 2 + 'px';
    line.hidden = false;
    drag.over = best;
  }
  function drop() {
    const d = drag, over = d.over, g = d.ghost.getBoundingClientRect(), b = box.getBoundingClientRect();
    drag = null;
    d.ghost.remove(); line.hidden = true;
    const x = Math.max(0, Math.round(g.left - b.left + box.scrollLeft)), y = Math.max(0, Math.round(g.top - b.top + box.scrollTop));
    if (over && over.kind === 'slot') {
      const old = over.node[over.i];
      over.node[over.i] = d.nodes[0];
      if (isOp(old) && !(over.spec.type === 'var' && old[0] === '_lv') && !['_kw', '_as'].includes(old[0])) stacks.push({ x: x + 24, y: y + 24, script: [old] });
    } else if (over && over.kind === 'list') {
      over.list.splice(over.idx, 0, ...d.nodes);
      if (over.top && over.idx === 0) over.top.y = Math.max(0, over.top.y - Math.round(g.height)); // keep the old blocks in place
    } else if (!over) stacks.push({ x, y, script: d.nodes });
    for (let i = stacks.length; i--;) if (!stacks[i].script.length && !stacks[i].body) stacks.splice(i, 1);
    changed();
  }

  // ── open function / object ──
  // The canvas edits the project's own nodes in place; only the layout (which stacks exist, and where) is written back,
  // by commit(), when another target opens. Object scripts become placed entries (krpj.md, Script layout): a lone hat
  // is stored bare as its hat node, anything else as its block list (loose). A function's body is the `body` stack.
  let target = null; // { kind: 'fn' | 'obj', data }
  function commit() {
    if (!target) return;
    const d = target.data;
    if (target.kind === 'fn') {
      const body = stacks.find((st) => st.body), loose = stacks.filter((st) => !st.body).map(({ x, y, script }) => ({ x, y, script }));
      d.x = body.x; d.y = body.y;
      if (loose.length) d.loose = loose; else delete d.loose;
    } else d.scripts = stacks.map((st) => ({ x: st.x, y: st.y, script: st.script.length === 1 && isHat(st.script[0]) ? st.script[0] : st.script, ...(st.loose && { loose: true }) }));
  }
  /** Shows a function ('fn', data = functions[key]) or object ('obj', data = objects[key]) on the canvas; null clears it. */
  function open(kind, data) {
    commit();
    target = kind ? { kind, data } : null;
    stacks.length = 0;
    if (kind === 'fn') {
      if (!Array.isArray(data.body)) data.body = [];
      stacks.push({ x: data.x, y: data.y, script: data.body, body: true });
      for (const l of data.loose || []) if (l && Array.isArray(l.script)) stacks.push({ x: l.x, y: l.y, script: l.script });
    } else if (kind === 'obj') {
      if (!Array.isArray(data.scripts)) data.scripts = [];
      for (const e of data.scripts) {
        const p = Array.isArray(e) ? { script: e } : e;
        if (p && Array.isArray(p.script)) stacks.push({ x: p.x, y: p.y, script: isHat(p.script) ? [p.script] : p.script, loose: p.loose });
      }
    }
    render();
    // auto-place unplaced (bare) scripts in a column below the placed ones
    const GAP = 24, els = box.children;
    let y = stacks.reduce((m, st, i) => st.x == null || st.y == null ? m : Math.max(m, st.y + els[i].offsetHeight + GAP), GAP);
    stacks.forEach((st, i) => {
      if (st.x != null && st.y != null) return;
      st.x = GAP; st.y = y; y += els[i].offsetHeight + GAP;
      els[i].style.left = st.x + 'px'; els[i].style.top = st.y + 'px';
    });
    box.scrollTo(0, 0);
  }

  // ── right-click menu ──
  /** Opcodes a block can switch to: same category and shape, same argument signature, shown in the palette. */
  function similar(op) {
    const key = (o) => { const i = OPS.get(o); return [i.cat, isHat([o]), isReporter([o]), BOOLISH.test(o), i.args.map((a) => a.type + (a.opt ? '?' : '') + (a.rest ? '*' : ''))].join('|'); };
    const k = key(op);
    return op[0] === '_' ? [] : OPCODES.filter((o) => o.name !== op && o.name[0] !== '_' && visible(o) && key(o.name) === k).map((o) => o.name);
  }
  const shortLabel = (op) => (LABELS[op] || generic(OPS.get(op))).replace(/%\d+/g, '…').replace(/\s+/g, ' ').trim();
  function context(e) {
    if (e.target === editing && e.target.tagName === 'INPUT') return; // already typing in it: the browser's menu (copy/paste)
    let acts = [];
    for (let t = e.target; !acts.length && t && box.contains(t); t = t.parentElement) acts = actions(t);
    if (!acts.length) return;
    e.preventDefault();
    popup({ getBoundingClientRect: () => ({ left: e.clientX, top: e.clientY, bottom: e.clientY }) }, acts, null, (f) => f(), false);
  }
  /** Right-click options for a block (statement or reporter in a slot) or input element: [action, label]. */
  function actions(t) {
    const ref = refs.get(t);
    if (!ref || (ref.kind !== 'stmt' && ref.kind !== 'slot')) return [];
    const n = ref.kind === 'stmt' ? ref.list[ref.i] : isOp(ref.node[ref.i]) ? ref.node[ref.i] : null, acts = [];
    if (n && isReporter(n)) acts.push([() => print(n, t.getBoundingClientRect()), 'print output']);
    if (ref.kind === 'slot' && !['var', 'ref', 'script'].includes(ref.spec.type)) {
      const v = ref.node[ref.i], set = (x) => () => { ref.node[ref.i] = x; };
      if (isOp(v) && v[0] === '_lv') acts.push([set(defaultFor(ref.spec, ref.node[0])), 'use a value instead']);
      else if (!isOp(v) || v[0] === '_kw' || v[0] === '_as') acts.push([set(['_lv', knownVars()[0] || 'myvar']), 'use a variable instead']);
    }
    if (n) for (const op of similar(n[0])) acts.push([() => { n[0] = op; }, 'switch to: ' + shortLabel(op)]);
    return acts;
  }

  // "print output": the block runs in krplayer (kressel_eval.js, URL from <meta name="kreditor-eval">, loaded on first use).
  let bubble = null, evalLoad = null, editing = null; // editing: focus before the right-click (mouse-down moves it)
  const closeBubble = () => { if (bubble) bubble.remove(); bubble = null; };
  function evaluator() {
    return evalLoad ||= new Promise((ok, fail) => {
      if (window.kresselEval) return ok(window.kresselEval);
      const src = (document.querySelector('meta[name="kreditor-eval"]') || {}).content;
      if (!src) return fail(new Error('the page has no <meta name="kreditor-eval">'));
      const s = h('script');
      s.src = src;
      s.onload = () => window.kresselEval ? ok(window.kresselEval) : fail(new Error(src + ' did not define kresselEval'));
      s.onerror = () => { evalLoad = null; fail(new Error('could not load ' + src)); };
      document.head.append(s);
    });
  }
  async function print(n, r) {
    closeBubble();
    const b = bubble = h('div', 'kr-bubble', '…');
    b.style.left = r.left + 'px'; b.style.top = r.bottom + 4 + 'px';
    document.body.append(b);
    let out;
    try {
      const { value, type } = await (await evaluator())(structuredClone(n));
      out = type === 'string' ? JSON.stringify(value) : value;
      b.title = type;
    } catch (err) { out = err.message || String(err); b.classList.add('err'); }
    b.textContent = out;
  }

  function init() {
    box = document.querySelector('.w-code-box'); list = document.querySelector('.w-code-list');
    line = h('div', 'c-drop'); line.hidden = true;
    document.body.append(line);
    palette(); render();
    box.addEventListener('pointerdown', down); list.addEventListener('pointerdown', down);
    addEventListener('pointerdown', (e) => { editing = document.activeElement; closeBubble(); if (pop && !pop.contains(e.target)) closePopup(); }, true);
    box.addEventListener('scroll', () => { closePopup(); closeBubble(); });
    box.addEventListener('contextmenu', context);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  const api = { stacks, render, template, OPS, sources, open, commit, popup, closePopup, current: () => target && target.data, onchange: null };
  return api;
})();
