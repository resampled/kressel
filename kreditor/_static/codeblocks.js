// Code blocks: the palette (.w-code-list) and the script canvas (.w-code-box). Blocks are krpj script nodes
// (docs/krpj_opcodes.md); the canvas renders from `kreditorCode.stacks` and every drag edits that model, then re-renders.
// Inputs: each argument's type in the opcode table picks its slot (number, text, true/false, key, colour, dropdown,
// variable name, asset name, or a C-block mouth for `script`). Any non-mouth slot also takes a dropped reporter,
// which replaces the literal; dragging the reporter back out restores the slot's default.
// Classic script (no modules) so kreditor.html opens from file://. Needs opcodes.gen.js loaded first.
var kreditorCode = (function () {
  'use strict';
  const CATS = [['evt', 'Events'], ['ctr', 'Control'], ['fnc', 'Functions'], ['opr', 'Operators'], ['var', 'Variables'],
    ['ins', 'Instances'], ['mov', 'Movement'], ['sen', 'Sensing'], ['lks', 'Looks'], ['snd', 'Sound'], ['drw', 'Drawing'],
    ['rom', 'Rooms'], ['cam', 'Camera'], ['dat', 'Data'], ['sys', 'System']];
  const COLOUR = { ctr: 'ctl', _: 'var' }; // category -> .c-<colour> class, when they differ
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
    return [o.name, { ...o, args, cat: o.name[0] === '_' ? (/^_(kw|as)$/.test(o.name) ? 'ins' : '_') : o.name.split('_')[0], gml: gml && gml[1] }];
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
  for (let c = 48; c <= 90; c++) if (c <= 57 || c >= 65) KEYS[c] = String.fromCharCode(c);
  for (let f = 1; f <= 12; f++) KEYS[111 + f] = 'F' + f;

  // %n = argument n (node[n]); `script` arguments become C-block mouths. Unlisted opcodes get a generated label.
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
    _lv: '%1', _kw: '%1', _as: '%1', _fn: 'function %1', _iv: '%1 . %2', _ar: 'array %1', _ai: '%1 [ %2 ]',
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
      case 'ref': return a.opts[0] || (REF_OPTS[op] || [''])[0] || (op === '_lv' ? 'myvar' : '');
      case 'layer': return 'Instances';
      case 'arr': return ['_ar'];
      case 'struct': return {};
      default: return ASSET_TYPES.has(a.type) ? ['_as', ''] : 0;
    }
  }
  /** A new node for the palette: required arguments filled with defaults (plus an empty body for hats). */
  function template(op) {
    const n = [op];
    for (const a of OPS.get(op).args) { if (a.opt) break; n.push(defaultFor(a, op)); if (a.rest) break; }
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
  function pick(options, value, onSet) {
    const s = h('select', '', ...options.map(([v, label]) => { const o = h('option', '', label); o.value = v; return o; }));
    s.value = value;
    s.onchange = () => onSet(s.value);
    return s;
  }

  /** The input for node[i]: an editor for a literal, or the reporter block sitting in it. */
  function slot(node, i, a) {
    const v = node[i], t = a.type, set = (x) => { node[i] = x; };
    const wrap = (c, cls) => tag(h('span', 'slot ' + (cls || 'in-' + t), c), { kind: 'slot', node, i, spec: a });
    if (isOp(v)) {
      if (v[0] === '_lv' && t === 'var') return wrap(text(v[1], (s) => set(['_lv', s])), 'in-var');
      if ((v[0] === '_kw' || v[0] === '_as') && (t === 'inst' || ASSET_TYPES.has(t))) {
        const inp = text(v[1], (s) => set([t === 'inst' && REF_OPTS._kw.includes(s) ? '_kw' : '_as', s]));
        if (t === 'inst') inp.setAttribute('list', 'kr-kw');
        inp.placeholder = t;
        return wrap(inp, 'in-asset');
      }
      return tag(block(v, true), { kind: 'slot', node, i, spec: a });
    }
    if (t === 'ref') {
      const opts = a.opts.length ? a.opts : REF_OPTS[node[0]];
      return wrap(opts ? pick(opts.map((o) => [o, o.replace(/_/g, ' ')]), v, set) : text(v == null ? '' : v, set), 'in-ref');
    }
    if (t === 'bool' && typeof v === 'boolean') return wrap(pick([['true', 'true'], ['false', 'false']], String(v), (s) => set(s === 'true')));
    if (t === 'key' && typeof v === 'number') return wrap(pick(Object.entries(KEYS), String(v), (s) => set(Number(s))));
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
      const btn = (label, fn) => { const b = h('button', 'pm', label); b.onclick = () => { fn(); render(); }; target.append(b); };
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
  let box, list, line, kwList;
  const palOpts = { hidden: false, compat: false }; // also list opcodes with these flags in the palette
  function render() {
    box.replaceChildren(...stacks.map((st) => {
      const s = stack(st.script, st);
      s.style.left = st.x + 'px'; s.style.top = st.y + 'px';
      return s;
    }));
  }

  // Section headings are sticky at both edges (CSS), offset by their index: headings of sections scrolled past pile up
  // at the top of the list in order, those still below pile up at the bottom. Clicking one scrolls to its section.
  function palette() {
    const out = [];
    const show = (o) => Object.keys(palOpts).every((f) => palOpts[f] || !o.flags.includes(f));
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
      if (cat === 'var') for (const n of ['_lv', '_iv', '_ai', '_ar']) nodes.push(template(n));
      for (const o of OPCODES) {
        if (OPS.get(o.name).cat !== cat || !show(o)) continue;
        nodes.push(template(o.name));
        if (o.name === 'ctr_if') nodes.push(['ctr_if', true, [], []]);
      }
      if (cat === 'var') nodes[1] = ['_iv', ['_kw', 'global'], 'myvar'];
      for (const n of nodes) out.push(tag(h('div', 'pal', block(n, isReporter(n))), { kind: 'pal', node: n }));
    }
    for (const [f, label] of [['hidden', 'Show hidden blocks'], ['compat', 'Show GameMaker compatibility blocks']]) {
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
    if (!pal &&e.target.closest('input, select, button')) return;
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
    for (let i = stacks.length; i--;) if (!stacks[i].script.length) stacks.splice(i, 1);
    render();
  }

  function init() {
    box = document.querySelector('.w-code-box'); list = document.querySelector('.w-code-list');
    line = h('div', 'c-drop'); line.hidden = true;
    kwList = h('datalist', '', ...REF_OPTS._kw.map((k) => { const o = h('option'); o.value = k; return o; }));
    kwList.id = 'kr-kw';
    document.body.append(line, kwList);
    palette(); render();
    box.addEventListener('pointerdown', down); list.addEventListener('pointerdown', down);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return { stacks, render, template, OPS };
})();
