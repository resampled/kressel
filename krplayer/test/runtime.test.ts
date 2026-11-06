import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Krpj, Script } from '../src/krpj.ts';
import { createHeadless } from '../src/platform/headless.ts';
import { load, prepare } from '../src/play.ts';
import { equals, str, add } from '../src/value.ts';
import { follow } from '../src/runtime/game.ts';
import { warpSetup } from '../src/runtime/debug.ts';

function project(objects: Krpj['objects'], instances: { object: string; x: number; y: number }[]): Krpj {
  return {
    krpj_v: '0.1',
    cfg_db_relay: { slug: 't', title: 't', author: '', revision: 1, date_created: 0, date_updated: 0 },
    cfg_gm_compat: { imported_from: null }, cfg_defaults: { width: 'default', height: 'default', fps: 60, window_title: 't' },
    cfg_project: { init_room: 'rm' },
    sprites: { spr_box: { name: 'spr_box', frames: ['./box.png'], origin: [0, 0], speed: 0 } }, sounds: {}, fonts: {},
    objects, rooms: { rm: { width: 100, height: 100, layers: [{ name: 'I', type: 'instances', depth: 0, instances }], scripts: [] } },
  };
}
const obj = (scripts: unknown[], sprite: string | null = null) => ({ sprite, parent: null, visible: true, persistent: false, scripts: scripts as Script[] });

/** Runs `body` as the create event of one instance; returns that instance's user vars by name. */
async function exec(body: unknown[], frames = 0) {
  const p = createHeadless(() => [10, 10]);
  const g = await load({ krpj: project({ o: obj([['evt_create', body]]) }, [{ object: 'o', x: 0, y: 0 }]), url: (x) => x }, p);
  for (let i = 0; i < frames; i++) g.frame();
  const inst = g.instances[0];
  return Object.fromEntries([...inst.vars].map(([i, v]) => [g.a.varNames[i], v]));
}

test('value rules: epsilon equality, no number+string, string()', () => {
  assert.equal(equals(0.1 + 0.2, 0.3), true);
  assert.throws(() => add(1, 'a'), /unable to add/);
  assert.deepEqual([str(100), str(1.5), str(undefined)], ['100', '1.50', 'undefined']);
});

test('real division by zero gives inf / NaN instead of failing (ch1_ribbit_mod obj_crackintro)', async () => {
  const v = await exec([
    ['var_set', ['_lv', 'z'], 0],
    ['var_set', ['_lv', 'nan'], ['opr_div', 0, ['_lv', 'z']]],
    ['var_set', ['_lv', 'inf'], ['opr_div', -3, ['_lv', 'z']]],
    ['var_set', ['_lv', 'q'], 5],
    ['var_change', '/', ['_lv', 'q'], ['_lv', 'z']],
  ]);
  assert.deepEqual([Number.isNaN(v.nan), v.inf, v.q], [true, -Infinity, Infinity]);
});

test('locals, loops, switch fall-through, compound assignment', async () => {
  const v = await exec([
    ['var_local', 'i', 0],
    ['var_set', ['_lv', 'sum'], 0],
    ['ctr_while', ['opr_lt', ['_lv', 'i'], 5], [['var_change', '+', ['_lv', 'sum'], ['_lv', 'i']], ['var_inc', ['_lv', 'i']]]],
    ['ctr_repeat', 3, [['var_change', '*', ['_lv', 'sum'], 2]]],
    ['var_set', ['_lv', 'r'], ''],
    ['ctr_switch', 1, [['ctr_case', 0], ['var_set', ['_lv', 'r'], 'zero'], ['ctr_case', 1], ['var_change', '+', ['_lv', 'r'], 'a'], ['ctr_case', 2], ['var_change', '+', ['_lv', 'r'], 'b'], ['ctr_break'], ['ctr_default'], ['var_set', ['_lv', 'r'], 'd']]],
    ['var_set', ['_ai', ['_lv', 'arr'], 2], 7],
  ]);
  assert.equal(v.sum, 80);
  assert.equal(v.r, 'ab');
  assert.deepEqual(v.arr, [0, 0, 7]);
  assert.equal('i' in v, false); // locals aren't instance variables
});

test('compile errors name the opcode and its location', async () => {
  await assert.rejects(exec([['nope_nope']]), /unknown opcode "nope_nope" at o\/evt_create\/0/);
});

test('runtime errors name the statement', async () => {
  await assert.rejects(exec([['var_set', ['_lv', 'a'], ['_lv', 'missing']]]), /o\/evt_create\/0: variable missing not set before reading it/);
});

test('motion, with, collisions and alarms', async () => {
  const p = createHeadless(() => [10, 10]);
  const pj = project({
    mover: obj([
      ['evt_create', [['var_set', ['_lv', 'hspeed'], 2], ['var_set', ['_ai', ['_lv', 'alarm'], 0], 3], ['var_set', ['_lv', 'hits'], 0], ['var_set', ['_lv', 'rang'], false]]],
      ['evt_alarm', 0, [['var_set', ['_lv', 'rang'], true]]],
      ['evt_collision', ['_as', 'wall'], [['var_inc', ['_lv', 'hits']], ['ctr_with', ['_kw', 'other'], [['var_set', ['_lv', 'touched'], true]]]]],
    ], 'spr_box'),
    wall: obj([['evt_create', [['var_set', ['_lv', 'touched'], false]]]], 'spr_box'),
  }, [{ object: 'mover', x: 0, y: 0 }, { object: 'wall', x: 15, y: 0 }]);
  const g = await load({ krpj: pj, url: (x) => x }, p);
  for (let i = 0; i < 4; i++) g.frame();
  const [m, w] = g.instances, slot = (n: string) => g.a.varNames.indexOf(n);
  assert.equal(m.x, 8);
  assert.equal(m.vars.get(slot('rang')), true);
  assert.ok((m.vars.get(slot('hits')) as number) >= 1);
  assert.equal(w.vars.get(slot('touched')), true);
});

test('precise masks collide per pixel (diagonal slope)', async () => {
  // 8x8 lower-left triangle: row y has pixels 0..y set.
  const bits = new Uint8Array(8).map((_, y) => (0xff << (7 - y)) & 0xff);
  const p = createHeadless(() => [8, 8], undefined, async () => bits);
  const pj = project({ o: obj([], 'spr_box'), slope: obj([], 'spr_tri') }, [{ object: 'o', x: 0, y: 0 }, { object: 'slope', x: 10, y: 10 }]);
  pj.sprites.spr_tri = { name: 'spr_tri', frames: ['./tri.png'], origin: [0, 0], speed: 0, mask: 'precise', mask_bits: './tri.bin' };
  const g = await load({ krpj: pj, url: (x) => x }, p);
  const [o, s] = g.instances;
  const hit = (x: number, y: number) => g.placeMeeting(o, x, y, s.id) !== null;
  assert.equal(hit(17, 9), false); // overlaps only the empty upper-right half, which a bbox test would hit
  assert.equal(hit(17, 10), true); // reaches pixel (7, 7)
  assert.equal(hit(12, 5), true); // reaches pixel (2, 2)
  assert.equal(hit(13, 5), false);
});

test('equal depth: the newest instance draws first', async () => {
  const log = (tag: string) => ['evt_draw', [['var_change', '+', ['_iv', ['_kw', 'global'], 'order'], tag]]];
  const p = createHeadless(() => [10, 10]);
  const pj = project({
    a: obj([['evt_create', [['var_set', ['_iv', ['_kw', 'global'], 'order'], ''], ['ins_create_depth', 0, 0, 0, ['_as', 'c']]]], log('a')]),
    b: obj([log('b')]), c: obj([log('c')]),
  }, [{ object: 'a', x: 0, y: 0 }, { object: 'b', x: 0, y: 0 }]);
  const g = await load({ krpj: pj, url: (x) => x }, p);
  g.frame();
  assert.equal(g.globalScope.vars.get(g.a.varNames.indexOf('order')), 'cba');
});

test('the application surface keeps its size when a room view port has another aspect', async () => {
  const pj = project({ o: obj([]) }, [{ object: 'o', x: 0, y: 0 }]);
  Object.assign(pj.rooms!.rm, { views_enabled: true, views: [{ view: [0, 0, 100, 100], port: [0, 0, 200, 50], visible: true }] });
  const g = await load({ krpj: pj, url: (x) => x }, createHeadless(() => [10, 10]));
  g.frame();
  const s = g.surface(0);
  assert.deepEqual([s.w, s.h], [100, 100]);
});

/** Like exec, with user functions in the project. */
async function execFn(body: unknown[], functions: Krpj['functions'], scripts: (string | null)[] = []) {
  const p = createHeadless(() => [10, 10]);
  const pj = { ...project({ o: obj([['evt_create', body]]) }, [{ object: 'o', x: 0, y: 0 }]), functions, scripts };
  const g = await load({ krpj: pj, url: (x) => x }, p);
  const inst = g.instances[0];
  return Object.fromEntries([...inst.vars].map(([i, v]) => [g.a.varNames[i], v]));
}

test('user functions: arguments, argument_count, return; script ids call through script_execute', async () => {
  const v = await execFn([
    ['var_set', ['_lv', 'a'], ['fnc_g', 'add2', 3, 4]],
    ['var_set', ['_lv', 'n'], ['fnc_g', 'count']],
    ['var_set', ['_lv', 'c'], ['ctr_script_execute', ['_fn', 'add2'], 10, 5]],
  ], {
    add2: { args: [], body: [['ctr_return', ['opr_add', ['_lv', 'argument0'], ['_lv', 'argument1']]]] },
    count: { args: [], body: [['ctr_return', ['_lv', 'argument_count']]] },
  }, ['add2']);
  assert.deepEqual([v.a, v.n, v.c], [7, 0, 15]);
});

test('methods bind self; structs come from constructors', async () => {
  const v = await execFn([
    ['var_set', ['_lv', 'hp'], 10],
    ['var_set', ['_lv', 'hit'], ['var_method', -1, ['_fn', 'hurt']]],
    ['fnc_m', ['_lv', 'hit'], 3],
    ['var_set', ['_lv', 'p'], ['fnc_new', 'Point', 1, 2]],
    ['var_set', ['_lv', 'px'], ['_iv', ['_lv', 'p'], 'x2']],
  ], {
    hurt: { args: [], body: [['var_change', '-', ['_lv', 'hp'], ['_lv', 'argument0']]] },
    Point: { args: [], body: [['var_set', ['_lv', 'x2'], ['_lv', 'argument0']], ['var_set', ['_lv', 'y2'], ['_lv', 'argument1']]], ctor: true },
  });
  assert.equal(v.hp, 7);
  assert.equal(v.px, 1);
});

test('arrays are copied on write through a variable that does not own them (copy-on-write)', async () => {
  const v = await execFn([
    ['var_set', ['_lv', 'a'], ['_ar', 1, 2, 3]],
    ['var_set', ['_lv', 'b'], ['_lv', 'a']],
    ['var_set', ['_ai', ['_lv', 'b'], 0], 99],
    ['fnc_g', 'poke', ['_lv', 'a']],
    ['var_set', ['_ai', ['_ai', ['_lv', 'grid'], 1], 2], 5],
  ], { poke: { args: [], body: [['var_set', ['_ai', ['_lv', 'argument0'], 1], 42]] } });
  assert.deepEqual(v.a, [1, 2, 3]);
  assert.deepEqual(v.b, [99, 2, 3]);
  assert.deepEqual(v.grid, [0, [0, 0, 5]]);
});

test('obj.var = v with no instance of obj does nothing (only reads fail)', async () => {
  const v = await exec([['var_set', ['_iv', ['_as', 'o2'], 'z'], 1], ['var_set', ['_lv', 'ok'], true]]).catch((e: Error) => e.message);
  // 'o2' isn't an asset in this project, so use an object with no instances instead:
  assert.match(String(v), /unknown asset "o2"/);
  const p = createHeadless(() => [10, 10]);
  const pj = project({
    o: obj([['evt_create', [['var_set', ['_iv', ['_as', 'none'], 'z'], 1], ['var_set', ['_lv', 'ok'], true]]]]),
    none: obj([]),
  }, [{ object: 'o', x: 0, y: 0 }]);
  const g = await load({ krpj: pj, url: (x) => x }, p);
  assert.equal(g.instances[0].vars.get(g.a.varNames.indexOf('ok')), true);
});

test('event_inherited runs the parent object\'s version of the event', async () => {
  const p = createHeadless(() => [10, 10]);
  const pj = project({
    base: obj([['evt_create', [['var_set', ['_lv', 'log'], ['opr_add', ['_lv', 'log'], 'b']]]]]),
    kid: { ...obj([['evt_create', [['var_set', ['_lv', 'log'], 'k'], ['ins_event_inherited']]]]), parent: 'base' },
  }, [{ object: 'kid', x: 0, y: 0 }]);
  const g = await load({ krpj: pj, url: (x) => x }, p);
  assert.equal(g.instances[0].vars.get(g.a.varNames.indexOf('log')), 'kb');
});

test('debug start room: warp redirects the first room change, direct skips the init room', async () => {
  const pj = project({}, []), room = pj.rooms!.rm;
  pj.rooms = { rm: room, rm2: room, rm3: room };
  const p = createHeadless(() => [10, 10]), src = { krpj: pj, url: (x: string) => x };
  const g = await prepare(src, p);
  assert.equal(g.findRoom('rm3'), 2);
  assert.equal(g.findRoom('1'), 1);
  assert.equal(g.findRoom('nope'), -1);
  g.start(2);
  assert.equal(g.room.name, 'rm');
  g.goto(1); g.frame();
  assert.equal(g.room.name, 'rm3');
  g.goto(1); g.frame();
  assert.equal(g.room.name, 'rm2');
  const d = await prepare(src, p);
  d.start(1, true);
  assert.equal(d.room.name, 'rm2');
});

test('view follow: a border of half the view or more centres the target (GM CCamera.Update)', () => {
  // Deltarune Ch1 room_schoollobby: 320x240 view, border 160x240, room 940x420, Kris at markerB (110, 200).
  assert.equal(follow(0, 110, 320, 160, -1, 940), 0); // centred at -50, clamped
  assert.equal(follow(0, 200, 240, 240, -1, 420), 80); // centred, not pushed down to 180
  // Smaller border: scroll only past it, then clamp, then the speed limit.
  assert.equal(follow(0, 50, 100, 20, -1, 1000), 0);
  assert.equal(follow(0, 150, 100, 20, -1, 1000), 70);
  assert.equal(follow(0, 150, 100, 20, 5, 1000), 5);
  // A view larger than the room ends up at a negative position (left clamp runs first).
  assert.equal(follow(0, 10, 200, 20, -1, 100), -100);
});

test('debug warp setup: ?set= and ?call= run in URL order just before the warp room is entered', async () => {
  const pj = project({ w: obj([['evt_create', [['var_set', ['_lv', 'seen'], ['opr_add', ['_iv', ['_kw', 'global'], 'zone'], ['_ai', ['_iv', ['_kw', 'global'], 'arr'], 2]]]]]]) }, []);
  const rm = pj.rooms!.rm;
  pj.rooms = { rm, rm2: { ...rm, layers: [{ name: 'I', type: 'instances', depth: 0, instances: [{ object: 'w', x: 0, y: 0 }] }] } };
  pj.functions = { mk: { args: [], body: [['var_set', ['_iv', ['_kw', 'global'], 'zone'], ['opr_mul', ['_lv', 'argument0'], 2]]] } };
  const g = await prepare({ krpj: pj, url: (x) => x }, createHeadless(() => [10, 10]));
  const q = new URLSearchParams('set=zone=1,arr[2]=5,s="a,b"&call=mk(3)');
  assert.throws(() => warpSetup(g, new URLSearchParams('call=nope')), /no such function/);
  g.start(1, false, warpSetup(g, q));
  g.goto(0); g.frame();
  const gv = (n: string) => g.globalScope.vars.get(g.a.varSlot(n));
  assert.equal(g.instances[0].vars.get(g.a.varSlot('seen')), 11);
  assert.deepEqual([gv('arr'), gv('s')], [[0, 0, 5], 'a,b']);
});

test('pre-create runs before create (GMS2 event 14)', async () => {
  const pj = project({ o: obj([['evt_create', [['var_change', '+', ['_lv', 'log'], 'c']]], ['evt_pre_create', [['var_set', ['_lv', 'log'], 'p']]]]) }, [{ object: 'o', x: 0, y: 0 }]);
  const g = await load({ krpj: pj, url: (x) => x }, createHeadless(() => [10, 10]));
  assert.equal(g.instances[0].vars.get(g.a.varSlot('log')), 'pc');
});

test('sprite_add: an included image as a strip, with sprite_collision_mask building a precise mask', async () => {
  // A 4x2 image: two 2x2 frames; only the top-left pixel of frame 0 is opaque.
  const px = new Uint8ClampedArray(4 * 2 * 4);
  px[3] = 255;
  const pj = project({ o: obj([['evt_create', [
    ['var_set', ['_lv', 's'], ['lks_sprite_add', 'img/strip.png', 2, false, false, 1, 0]],
    ['var_set', ['_lv', 'w'], ['lks_sprite_info', 'width', ['_lv', 's']]],
    ['var_set', ['_lv', 'n'], ['lks_sprite_info', 'number', ['_lv', 's']]],
    ['var_set', ['_lv', 'missing'], ['lks_sprite_add', 'img/none.png', 1, false, false, 0, 0]],
    ['lks_sprite_collision_mask', ['_lv', 's'], true, 1, 0, 0, 0, 0, 0, 0],
  ]]]) }, [{ object: 'o', x: 0, y: 0 }]);
  pj.included_files = { 'img/strip.png': './files/img/strip.png' };
  const p = createHeadless(() => [10, 10], undefined, async () => new Uint8Array(1), { decodeImage: async () => ({ w: 4, h: 2, data: px }) });
  const g = await load({ krpj: pj, url: (x) => x }, p);
  const v = (k: string) => g.instances[0].vars.get(g.a.varSlot(k));
  assert.deepEqual([v('w'), v('n'), v('missing')], [2, 2, -1]);
  const sp = g.a.sprites[v('s') as number];
  assert.deepEqual([sp.ox, sp.maskKind, sp.nBits, [...sp.bits!]], [1, 2, 2, [0x80, 0, 0, 0]]);
});
