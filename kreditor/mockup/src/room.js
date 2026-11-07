// Room editor: draws a room's layers on a canvas and places/moves/erases instances.
import { app, el, commit, assetUrl, num, check, colour, select, fields, section, hexOf } from './state.js';

const ui = { tool: 'select', snap: true, grid: 16, zoom: 1, layer: 0, inst: null, place: null };
const imgs = new Map();
let redraw = () => {};
function image(path) {
  const url = assetUrl(path);
  if (!url) return null;
  let i = imgs.get(url);
  if (!i) { i = new Image(); i.onload = () => redraw(); i.src = url; imgs.set(url, i); }
  return i.complete && i.naturalWidth ? i : null;
}
const frame = (spr, idx = 0) => spr && image(spr.frames[Math.floor(idx) % spr.frames.length | 0] ?? spr.frames[0]);
const css = (bgr, a = 1) => { const h = hexOf(bgr ?? 0); return a >= 1 ? h : h + Math.round(a * 255).toString(16).padStart(2, '0'); };

/** Instance box in room pixels [x, y, w, h] (unrotated). */
function box(inst) {
  const o = app.project.objects?.[inst.object], spr = app.project.sprites[o?.sprite], f = frame(spr, inst.image_index);
  if (!f) return [inst.x - 8, inst.y - 8, 16, 16];
  const sx = inst.scale_x ?? 1, sy = inst.scale_y ?? 1;
  const x0 = inst.x - spr.origin[0] * sx, y0 = inst.y - spr.origin[1] * sy, x1 = x0 + f.naturalWidth * sx, y1 = y0 + f.naturalHeight * sy;
  return [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
}
function drawSprite(g, spr, idx, x, y, sx = 1, sy = 1, angle = 0, alpha = 1) {
  const f = frame(spr, idx);
  if (!f) return false;
  g.save(); g.globalAlpha = alpha; g.translate(x, y); g.rotate(-angle * Math.PI / 180); g.scale(sx, sy);
  g.drawImage(f, -spr.origin[0], -spr.origin[1]);
  g.restore();
  return true;
}

function draw(g, room) {
  const P = app.project;
  g.fillStyle = room.show_colour === false ? '#000' : css(room.colour);
  g.fillRect(0, 0, room.width, room.height);
  for (const L of [...room.layers].sort((a, b) => b.depth - a.depth)) {
    if (L.visible === false) continue;
    g.save(); g.translate(L.x ?? 0, L.y ?? 0);
    if (L.type === 'background') {
      const spr = P.sprites[L.sprite], f = frame(spr, L.image_index);
      g.globalAlpha = L.alpha ?? 1;
      if (!f) { if (!L.sprite) { g.fillStyle = css(L.color); g.fillRect(-(L.x ?? 0), -(L.y ?? 0), room.width, room.height); } }
      else if (L.stretch) g.drawImage(f, 0, 0, room.width, room.height);
      else {
        const w = f.naturalWidth, h = f.naturalHeight;
        for (let x = L.htiled ? -w : 0; x < (L.htiled ? room.width : 1); x += w)
          for (let y = L.vtiled ? -h : 0; y < (L.vtiled ? room.height : 1); y += h) g.drawImage(f, x, y);
      }
    } else if (L.type === 'tiles') {
      const ts = P.tilesets?.[L.tileset], img = ts && image(ts.image);
      if (img) {
        const cw = ts.tile_w + 2 * ts.border_x, ch = ts.tile_h + 2 * ts.border_y;
        for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
          const id = L.data[r * L.cols + c] & 0x7ffff;
          if (id) g.drawImage(img, (id % ts.columns) * cw + ts.border_x, Math.floor(id / ts.columns) * ch + ts.border_y, ts.tile_w, ts.tile_h, c * ts.tile_w, r * ts.tile_h, ts.tile_w, ts.tile_h);
        }
      }
    } else if (L.type === 'assets') {
      for (const t of L.tiles ?? []) { const f = frame(P.sprites[t[2]]); if (f) g.drawImage(f, t[3], t[4], t[5], t[6], t[0], t[1], t[5] * t[7], t[6] * t[8]); }
      for (const s of L.sprites ?? []) drawSprite(g, P.sprites[s.sprite], s.image_index, s.x, s.y, s.scale_x, s.scale_y, s.angle, s.alpha);
    } else if (L.type === 'instances') {
      for (const inst of L.instances) {
        const o = P.objects?.[inst.object];
        if (!drawSprite(g, P.sprites[o?.sprite], inst.image_index, inst.x, inst.y, inst.scale_x, inst.scale_y, inst.angle, inst.alpha ?? 1)) {
          g.strokeStyle = '#9a93c9'; g.setLineDash([3, 2]); g.strokeRect(inst.x - 8, inst.y - 8, 16, 16); g.setLineDash([]);
          g.fillStyle = '#ece9ff'; g.font = '9px Verdana'; g.fillText(inst.object.replace(/^obj_/, '').slice(0, 10), inst.x - 8, inst.y - 10);
        }
      }
    }
    g.restore();
  }
  if (ui.inst) {
    const L = room.layers.find((l) => l.instances?.includes(ui.inst));
    const [x, y, w, h] = box(ui.inst);
    g.strokeStyle = '#ffff00'; g.lineWidth = 1 / ui.zoom; g.strokeRect(x + (L?.x ?? 0), y + (L?.y ?? 0), w, h);
  }
  if (room.views_enabled) for (const v of room.views ?? []) if (v.visible !== false) {
    g.strokeStyle = '#00ffff'; g.lineWidth = 2 / ui.zoom; g.strokeRect(...v.view);
  }
}

function hit(room, x, y) {
  const layers = room.layers.filter((l) => l.type === 'instances' && l.visible !== false).sort((a, b) => a.depth - b.depth);
  for (const L of layers) for (let i = L.instances.length; i--;) {
    const inst = L.instances[i], [bx, by, w, h] = box(inst);
    if (x - (L.x ?? 0) >= bx && x - (L.x ?? 0) < bx + w && y - (L.y ?? 0) >= by && y - (L.y ?? 0) < by + h) return { L, inst };
  }
  return null;
}
const snap = (v) => (ui.snap ? Math.round(v / ui.grid) * ui.grid : Math.round(v));
const instLayer = (room) => {
  let L = room.layers[ui.layer];
  if (L?.type !== 'instances') L = room.layers.find((l) => l.type === 'instances');
  if (!L) { L = { name: 'Instances', type: 'instances', depth: 0, instances: [] }; room.layers.unshift(L); }
  return L;
};

export function roomView(key) {
  const room = app.project.rooms[key], objs = Object.keys(app.project.objects ?? {});
  if (!room.layers.some((l) => l.instances?.includes(ui.inst))) ui.inst = null;
  if (!objs.includes(ui.place)) ui.place = objs[0] ?? null;
  const cv = el('canvas.room');
  const tool = (id, label) => el('button.tool', { textContent: label, 'aria-pressed': String(ui.tool === id), onclick: () => { ui.tool = id; app.render(); } });
  const placeSel = el('select', { onchange: (e) => { ui.place = e.target.value; ui.tool = 'place'; app.render(); } }, objs.map((o) => el('option', { value: o, textContent: o })));
  placeSel.value = ui.place ?? '';
  const status = el('div.room-size', {}, `${room.width} × ${room.height}`);
  redraw = () => {
    cv.width = Math.ceil(room.width * ui.zoom); cv.height = Math.ceil(room.height * ui.zoom);
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.setTransform(ui.zoom, 0, 0, ui.zoom, 0, 0);
    draw(g, room);
  };
  const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / ui.zoom, (e.clientY - r.top) / ui.zoom]; };
  cv.addEventListener('pointermove', (e) => { const [x, y] = at(e); status.textContent = `${room.width} × ${room.height}   ·   ${Math.floor(x)}, ${Math.floor(y)}`; });
  cv.addEventListener('pointerdown', (e) => {
    const [x, y] = at(e), h = hit(room, x, y);
    if (ui.tool === 'place') {
      if (!ui.place) return alert('Make an object first.');
      const L = instLayer(room), inst = { object: ui.place, x: snap(x - (L.x ?? 0)), y: snap(y - (L.y ?? 0)) };
      L.instances.push(inst); ui.inst = inst;
      return commit();
    }
    if (ui.tool === 'erase') { if (h) { h.L.instances.splice(h.L.instances.indexOf(h.inst), 1); ui.inst = null; commit(); } return; }
    ui.inst = h?.inst ?? null;
    if (!h) return app.render();
    const ox = h.inst.x, oy = h.inst.y;
    let moved = false;
    cv.setPointerCapture(e.pointerId);
    const mv = (m) => {
      const [mx, my] = at(m);
      h.inst.x = snap(ox + mx - x); h.inst.y = snap(oy + my - y);
      moved = moved || h.inst.x !== ox || h.inst.y !== oy;
      redraw();
    };
    cv.addEventListener('pointermove', mv);
    cv.addEventListener('pointerup', () => { cv.removeEventListener('pointermove', mv); moved ? commit() : app.render(); }, { once: true });
  });
  const zoomBtn = (label, z) => el('button.tool', { textContent: label, onclick: () => { ui.zoom = z(); app.render(); } });
  const pane = el('div.pane', {},
    el('div.room-tools', {},
      tool('select', 'Select / move'), tool('place', 'Place'), placeSel, tool('erase', 'Erase'),
      el('span.sep'),
      el('label.check', {}, el('input', { type: 'checkbox', checked: ui.snap, onchange: (e) => { ui.snap = e.target.checked; } }), ' Snap to'),
      el('input', { type: 'number', value: ui.grid, min: 1, style: { width: '4em' }, onchange: (e) => { ui.grid = Math.max(1, Number(e.target.value) || 16); } }), 'px',
      el('span.sep'),
      zoomBtn('−', () => Math.max(0.125, ui.zoom / 2)), el('span', {}, `${ui.zoom * 100}%`), zoomBtn('+', () => Math.min(8, ui.zoom * 2))),
    el('div.room-wrap', {}, cv, status));
  redraw();
  return pane;
}

addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' || !ui.inst || app.sel.view !== 'room' || e.target.closest?.('input, textarea, select')) return;
  for (const L of app.project.rooms[app.sel.key]?.layers ?? []) {
    const i = L.instances?.indexOf(ui.inst) ?? -1;
    if (i >= 0) { L.instances.splice(i, 1); ui.inst = null; commit(); return; }
  }
});

export function roomInspector(key) {
  const room = app.project.rooms[key], P = app.project, objs = Object.keys(P.objects ?? {}), sprs = Object.keys(P.sprites).map((k) => [k]);
  const out = [];
  out.push(section('Room', fields(
    ['Size', el('div.two', {}, num(room, 'width', 640), num(room, 'height', 360))],
    ['Clear colour', el('div.two', {}, colour(room, 'colour'), check(room, 'show_colour', 'Draw it', true))],
    ['', check(room, 'persistent', 'Persistent')])));

  if (ui.layer >= room.layers.length) ui.layer = 0;
  const addLayer = (L) => { room.layers.push(L); ui.layer = room.layers.length - 1; commit(); };
  const L = room.layers[ui.layer];
  const layers = el('section.insp', {},
    el('h3', {}, 'Layers',
      el('button', { textContent: '+ Instances', onclick: () => addLayer({ name: 'Instances_' + room.layers.length, type: 'instances', depth: -100 * room.layers.length, instances: [] }) }),
      el('button', { textContent: '+ Background', style: { marginLeft: '8px' }, onclick: () => addLayer({ name: 'Background_' + room.layers.length, type: 'background', depth: 100 + 100 * room.layers.length, color: 0, sprite: null }) })),
    el('ol.layers', {}, room.layers.map((l, i) => el('li', { 'aria-current': i === ui.layer ? 'true' : null, onclick: () => { ui.layer = i; app.render(); } },
      el('button.eye', { textContent: l.visible === false ? '○' : '◉', title: 'Show/hide', onclick: (e) => { e.stopPropagation(); l.visible = l.visible === false; commit(); } }),
      el('span.nm', { title: l.name }, l.name), el('small', {}, l.type), el('small', {}, String(l.depth))))));
  out.push(layers);
  if (L) {
    const f = [['Name', el('input', { type: 'text', value: L.name, onchange: (e) => { L.name = e.target.value; commit(); } })], ['Depth', num(L, 'depth')]];
    if (L.type === 'background') f.push(['Colour', colour(L, 'color')], ['Sprite', select(L, 'sprite', sprs, 'None')],
      ['', check(L, 'htiled', 'Tile horizontally')], ['', check(L, 'vtiled', 'Tile vertically')], ['', check(L, 'stretch', 'Stretch')]);
    f.push(['', el('button.btn', { textContent: 'Delete layer', onclick: () => { if (confirm(`Delete layer ${L.name}?`)) { room.layers.splice(ui.layer, 1); ui.layer = 0; commit(); } } })]);
    layers.append(fields(...f));
  }

  const inst = ui.inst;
  out.push(inst ? section('Selected instance', fields(
    ['Object', select(inst, 'object', objs.map((o) => [o]))],
    ['Position', el('div.two', {}, num(inst, 'x'), num(inst, 'y'))],
    ['Scale', el('div.two', {}, num(inst, 'scale_x', 1), num(inst, 'scale_y', 1))],
    ['Angle', num(inst, 'angle')],
    ['', el('button.btn', { textContent: 'Delete instance', onclick: () => { for (const l of room.layers) { const i = l.instances?.indexOf(inst) ?? -1; if (i >= 0) l.instances.splice(i, 1); } ui.inst = null; commit(); } })]))
    : section('Selected instance', el('small', {}, 'Pick “Place”, choose an object and click in the room. Select an instance to move or edit it.')));

  const v = room.views?.[0];
  const views = section('Camera', fields(['', el('label.check', {}, el('input', { type: 'checkbox', checked: !!room.views_enabled, onchange: (e) => {
    room.views_enabled = e.target.checked;
    if (room.views_enabled && !room.views?.length) room.views = [{ view: [0, 0, Math.min(640, room.width), Math.min(480, room.height)], port: [0, 0, Math.min(640, room.width), Math.min(480, room.height)], border: [32, 32], speed: [-1, -1], follow: null, visible: true }];
    commit();
  } }), ' Use a camera (view 0)')]));
  if (room.views_enabled && v) {
    const rect = (arr, i) => el('input', { type: 'number', value: arr[i], onchange: (e) => { arr[i] = Number(e.target.value); commit(); } });
    views.append(fields(
      ['Shows area', el('div.two', {}, rect(v.view, 0), rect(v.view, 1))], ['', el('div.two', {}, rect(v.view, 2), rect(v.view, 3))],
      ['On screen', el('div.two', {}, rect(v.port, 0), rect(v.port, 1))], ['', el('div.two', {}, rect(v.port, 2), rect(v.port, 3))],
      ['Follow', select(v, 'follow', objs.map((o) => [o]), 'Nothing')]));
  }
  out.push(views);
  return out;
}
