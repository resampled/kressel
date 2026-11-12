import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Krpj, Script } from '../src/krpj.ts';
import { createHeadless } from '../src/platform/headless.ts';
import { load, partition, prepare } from '../src/play.ts';
import { compare, equals, str, add } from '../src/value.ts';
import { follow } from '../src/runtime/game.ts';
import { warpSetup } from '../src/runtime/debug.ts';
import { md5 } from '../src/runtime/md5.ts';
import { errorKind } from '../src/vm/vm.ts';

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

test('a numeric string compares with a real as a number (DR ch2 c_wait("5"))', async () => {
  assert.deepEqual([compare('5', 0), compare(3, ' 5 '), compare('5abc', 5), equals('5', 5), equals(5, 'a')], [1, -1, 0, true, false]);
  assert.throws(() => compare('a', 1), /unable to compare string and number/);
  const v = await exec([
    ['var_set', ['_lv', 'amt'], '5'],
    ['var_set', ['_lv', 'gt'], ['opr_gt', ['_lv', 'amt'], 0]],
    ['var_set', ['_lv', 'gte'], ['opr_gte', 4, ['_lv', 'amt']]],
  ]);
  assert.deepEqual([v.gt, v.gte], [true, false]);
});

test('undefined orders against a real as unordered: < <= > >= all false (DR ch2 scr_monsterattackidcount)', async () => {
  const c = compare(undefined, 0), d = compare(1, undefined);
  assert.deepEqual([c < 0, c <= 0, c > 0, c >= 0, d < 0, d > 0, compare(undefined, undefined)], [false, false, false, false, false, false, 0]);
  const v = await exec([
    ['var_set', ['_lv', 'u'], ['_lv', 'undefined']],
    ['var_set', ['_lv', 'gt'], ['opr_or', ['opr_gt', 0, 1], ['opr_gt', ['_lv', 'u'], 0]]],
    ['var_set', ['_lv', 'lte'], ['opr_lte', ['_lv', 'u'], 0]],
  ]);
  assert.deepEqual([v.gt, v.lte], [false, false]);
});

test('md5 and buffer_md5 (DR ch2 obj_shapepuzzle)', async () => {
  const enc = (x: string) => new TextEncoder().encode(x);
  assert.equal(md5(enc('')), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5(enc('a'.repeat(56))), '3b0c8ac703f828b04c6c197006d17218'); // padding spills into a second block
  assert.equal(md5(enc('The quick brown fox jumps over the lazy dog')), '9e107d9d372bb6826bd81d3542a419d6');
  const v = await exec([
    ['var_set', ['_lv', 'b'], ['dat_buffer', 'create', 4, 0, 1]],
    ...[97, 98, 99, 100].map((c) => ['dat_buffer', 'write', ['_lv', 'b'], 1, c]),
    ['var_set', ['_lv', 'all'], ['dat_buffer', 'md5', ['_lv', 'b'], 0, -1]],
    ['var_set', ['_lv', 'abc'], ['dat_buffer', 'md5', ['_lv', 'b'], 0, 3]],
    ['var_set', ['_lv', 'tail'], ['dat_buffer', 'md5', ['_lv', 'b'], 2, 100]],
  ]);
  assert.deepEqual([v.all, v.abc, v.tail], [md5(enc('abcd')), '900150983cd24fb0d6963f7d28e17f72', md5(enc('cd'))]);
});

test('layer setters ignore a missing layer, getters give defaults (DR ch2 obj_controller_tasquePaintingsRevisit)', async () => {
  const v = await exec([
    ['rom_layer_set_visible', 'reference', 0],
    ['rom_layer_depth', 'reference', 5],
    ['rom_layer_set', 'x', 'reference', 3],
    ['rom_layer_set_visible', 'I', 0],
    ['var_set', ['_lv', 'vis'], ['rom_layer_get_visible', 'I']],
    ['var_set', ['_lv', 'gone'], ['rom_layer_get_visible', 'reference']],
    ['var_set', ['_lv', 'ld'], ['rom_layer_get_depth', 'reference']],
    ['var_set', ['_lv', 'lx'], ['rom_layer_get', 'x', 'reference']],
  ]);
  assert.equal(v.vis, false);
  assert.deepEqual([v.gone, v.ld, v.lx], [undefined, -1, 0]);
});

test('missing resources behave like GM, not errors (docs/error_audit.md)', async () => {
  const v = await exec([
    ['var_set', ['_lv', 'snd'], ['snd_play', 999, 0, false]], // audio_play_sound -> -1
    ['snd_gain', 999, 0.5, 0], ['snd_pitch', 999, 2],
    ['var_set', ['_lv', 'gain'], ['snd_get', 'gain', 999]],
    ['var_set', ['_lv', 'pitch'], ['snd_get', 'pitch', 999]],
    ['drw_sprite', 999, 0, 0, 0], ['drw_sprite_ext', -1, 0, 0, 0, 1, 1, 0, 0xffffff, 1],
    ['var_set', ['_lv', 'sw'], ['lks_sprite_info', 'width', 999]],
    ['var_set', ['_lv', 'sw0'], ['lks_sprite_info', 'width', '0']], // numeric string argument reads as 0
    ['dat_ini_open', 'a.ini'], ['dat_ini_write', 'string', 's', 'k', 'v'], ['dat_ini_open', 'b.ini'], ['dat_ini_close'],
    ['ins_event_user', 20],
    ['drw_set_font', 99],
    ['rom_sprite', 'x', 999, 5],
    ['var_set', ['_lv', 'ex'], ['rom_sprite', 'get_x', 999]],
    ['var_set', ['_lv', 'esc'], ['rom_sprite', 'get_xscale', 999]],
    ['cam_set_pos', 99, 1, 2],
    ['var_set', ['_lv', 'cx'], ['cam_get', 'x', 99]],
    ['var_set', ['_lv', 'px'], ['mov_path', 'get_x', 99, 0.5]],
    ['var_set', ['_lv', 'pn'], ['mov_path', 'get_number', 99]],
    ['var_set', ['_lv', 'b0'], ['dat_buffer', 'read', 99, 1]],
    ['var_set', ['_lv', 'b'], ['dat_buffer', 'create', 1, 0, 1]],
    ['var_set', ['_lv', 'b1'], ['dat_buffer', 'read', ['_lv', 'b'], 1]],
    ['var_set', ['_lv', 'b2'], ['dat_buffer', 'read', ['_lv', 'b'], 1]],
  ]);
  assert.deepEqual([v.snd, v.gain, v.pitch], [-1, 0, 1]);
  assert.deepEqual([v.sw, v.sw0], [0, 10]);
  assert.deepEqual([v.ex, v.esc, v.cx, v.px, v.pn], [0, 1, -1, -1, 0]);
  assert.deepEqual([v.b0, v.b1, v.b2], [0, 0, -3]); // past the end: eBuffer_OutOfBounds
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

test('make_colour_hsv wraps an out-of-range hue (DR ch2 obj_firework_explosion)', async () => {
  const hsv = (h: number) => ['drw_make_colour', 'hsv', h, 100, 255];
  const v = await exec([['var_set', ['_lv', 'neg'], hsv(-20)], ['var_set', ['_lv', 'pos'], hsv(235)], ['var_set', ['_lv', 'big'], hsv(255 + 40)], ['var_set', ['_lv', 'ok'], hsv(40)]]);
  assert.deepEqual([v.neg, v.big], [v.pos, v.ok]);
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

test('room instance order: pre-create event, instance pre_create (var overrides), create, creation code (DR ch2 doors)', async () => {
  const add = (s: string) => [['var_change', '+', ['_lv', 'log'], s]];
  const pj = project({ o: obj([['evt_create', add('c')], ['evt_pre_create', [['var_set', ['_lv', 'log'], 'p']]]]) },
    [{ object: 'o', x: 0, y: 0, pre_create: add('v'), creation: add('i') } as never]);
  const g = await load({ krpj: pj, url: (x) => x }, createHeadless(() => [10, 10]));
  assert.equal(g.instances[0].vars.get(g.a.varSlot('log')), 'pvci');
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

test('outside collisions and with, other is self (ch1_ribbit_mod obj_shop2 draws with other.rng)', async () => {
  const pj = project({ o: obj([
    ['evt_create', [['var_set', ['_lv', 'rng'], 3], ['var_set', ['_lv', 'c'], ['_iv', ['_kw', 'other'], 'rng']]]],
    ['evt_step', [['var_set', ['_lv', 's'], ['_iv', ['_kw', 'other'], 'rng']]]],
    ['evt_draw', [['var_set', ['_lv', 'd'], ['_iv', ['_kw', 'other'], 'rng']]]],
  ]) }, [{ object: 'o', x: 0, y: 0 }]);
  const g = await load({ krpj: pj, url: (x) => x }, createHeadless(() => [10, 10]));
  g.frame();
  const v = (k: string) => g.instances[0].vars.get(g.a.varSlot(k));
  assert.deepEqual([v('c'), v('s'), v('d')], [3, 3, 3]);
});

test('GMS1 view_xview/yview/wview/hview are builtins on the view camera (ch1_ribbit_mod obj_checkersfog)', async () => {
  const pj = project({ o: obj([['evt_create', [
    ['var_set', ['_ai', ['_lv', 'view_xview'], 0], 30],
    ['var_set', ['_lv', 'x0'], ['_ai', ['_lv', 'view_xview'], 0]],
    ['var_set', ['_lv', 'w0'], ['_ai', ['_lv', 'view_wview'], 0]],
  ]]]) }, [{ object: 'o', x: 0, y: 0 }]);
  Object.assign(pj.rooms!.rm, { views_enabled: true, views: [{ view: [5, 0, 80, 60], port: [0, 0, 80, 60], visible: true }] });
  const g = await load({ krpj: pj, url: (x) => x }, createHeadless(() => [10, 10]));
  const v = (k: string) => g.instances[0].vars.get(g.a.varSlot(k));
  assert.deepEqual([v('x0'), v('w0'), g.cameras[g.views[0].camera]!.x], [30, 80, 30]);
});

test('sprite_add removeback clears pixels of the bottom-left colour (ch1_ribbit_mod PROCESS_LOGO)', async () => {
  // 2x2: top row red/green, bottom row blue/blue (bottom-left is the key colour).
  const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
  const pj = project({ o: obj([['evt_create', [['var_set', ['_lv', 's'], ['lks_sprite_add', 'img/a.png', 1, true, false, 0, 0]]]]]) }, [{ object: 'o', x: 0, y: 0 }]);
  pj.included_files = { 'img/a.png': './files/img/a.png' };
  const p = createHeadless(() => [10, 10], undefined, async () => new Uint8Array(1), { decodeImage: async () => ({ w: 2, h: 2, data: px }) });
  const g = await load({ krpj: pj, url: (x) => x }, p);
  const sp = g.a.sprites[g.instances[0].vars.get(g.a.varSlot('s')) as number];
  assert.deepEqual([...sp.pixels![0].data].filter((_, i) => i % 4 === 3), [255, 255, 0, 0]);
  assert.equal(px[11], 255); // the decoded image is left as it was
});

test('placed scripts run; loose stacks, hat-less entries and hats with nothing after them are skipped', async () => {
  const log = (s: string) => [['var_change', '+', ['_iv', ['_kw', 'global'], 'log'], s]];
  const pj = project({
    o: obj([
      { x: 24, y: 24, script: ['evt_create', log('c')] },
      { x: 300, y: 80, script: log('loose') },          // a stack with no hat
      { x: 0, y: 0, loose: true, script: ['evt_create', log('flagged')] },
      log('bare'),                                       // a bare hat-less stack
      ['evt_step'], ['evt_alarm', 0], [],                // hats with no script, an empty entry
      { x: null, y: null, script: ['evt_draw', []] },    // an empty event
      ['evt_step', log('s')],
    ]),
  }, [{ object: 'o', x: 0, y: 0 }]);
  pj.global_init = [{ x: 0, y: 0, script: [['var_set', ['_iv', ['_kw', 'global'], 'log'], 'g']] }, { x: 9, y: 9, loose: true, script: log('no') }, []];
  pj.rooms!.rm.scripts = [{ x: 1, y: 1, script: ['evt_create', log('r')] }, { x: 5, y: 5, script: log('no') }, ['evt_create']];
  const g = await load({ krpj: pj, url: (x) => x }, createHeadless(() => [10, 10]));
  g.frame();
  assert.equal(g.globalScope.vars.get(g.a.varSlot('log')), 'gcrs');
});

test('try / catch: GML errors are caught with GM\'s error struct; krplayer gaps are not', async () => {
  const v = await exec([
    ['ctr_try', [['var_set', ['_lv', 'a'], ['var_arr_get', ['var_arr_create', 1], 5]], ['var_set', ['_lv', 'after'], 1]], 'e',
      [['var_set', ['_lv', 'msg'], ['_iv', ['_lv', 'e'], 'message']]]],
    ['ctr_while', true, [['ctr_try', [['ctr_break']], 'e2', []]]], // break out of a try inside a loop drops its handler
    ['ctr_try', [['var_set', ['_lv', 'ok'], 1]], 'e3', [['var_set', ['_lv', 'ok'], 2]]],
  ]);
  assert.match(String(v.msg), /array_get: index 5 out of range/);
  assert.equal(v.after, undefined);
  assert.equal(v.ok, 1);
  await assert.rejects(exec([['ctr_try', [['drw_texturegroup', 'no_such_member']], 'e', []]]), /not implemented in krplayer/);
});

test('paths: path_start follows the path (absolute and relative), fires the path end event and stops', async () => {
  const pj = project({
    o: obj([
      ['evt_create', [['var_set', ['_lv', 'ends'], 0], ['ctr_if', ['opr_eq', ['_lv', 'x'], 0], [['mov_path_start', ['_as', 'p'], 5, 0, true]], [['mov_path_start', ['_as', 'p'], 5, 0, false]]]]],
      ['evt_path_end', [['var_change', '+', ['_lv', 'ends'], 1]]],
    ]),
  }, [{ object: 'o', x: 0, y: 0 }, { object: 'o', x: 50, y: 50 }]);
  pj.paths = { p: { points: [[10, 10, 100], [30, 10, 100], [30, 20, 100]] } };
  const g = await load({ krpj: pj, url: (x) => x }, createHeadless(() => [10, 10]));
  const [a, r] = g.instances;
  assert.deepEqual([a.x, a.y, r.x, r.y], [10, 10, 50, 50]);
  g.frame(); // 5 px along: 30 px long path
  assert.deepEqual([a.x, a.y, r.x, r.y], [15, 10, 55, 50]);
  for (let i = 0; i < 6; i++) g.frame();
  assert.deepEqual([a.x, a.y, a.path, a.vars.get(g.a.varSlot('ends'))], [30, 20, -1, 1]);
  assert.equal(g.paths.get(0, 't').length(), 30);
});

test('event_perform(ev_other, ev_user0) runs user event 0 (Ch2 obj_teacup)', async () => {
  const pj = project({ o: obj([['evt_create', [['ins_event_perform', 7, 10]]], ['evt_user', 0, [['var_set', ['_lv', 'ran'], 1]]]]) }, [{ object: 'o', x: 0, y: 0 }]);
  const g = await load({ krpj: pj, url: (x) => x }, createHeadless(() => [10, 10]));
  assert.equal(g.instances[0].vars.get(g.a.varSlot('ran')), 1);
});

test('ds_queue and ds_priority', async () => {
  const v = await exec([
    ['var_set', ['_lv', 'q'], ['dat_queue', 'create']], ['dat_queue', 'enqueue', ['_lv', 'q'], 1, 2],
    ['var_set', ['_lv', 'h'], ['dat_queue', 'dequeue', ['_lv', 'q']]],
    ['var_set', ['_lv', 'p'], ['dat_priority', 'create']],
    ['dat_priority', 'add', ['_lv', 'p'], 'b', 5], ['dat_priority', 'add', ['_lv', 'p'], 'a', 1], ['dat_priority', 'add', ['_lv', 'p'], 'c', 9],
    ['var_set', ['_lv', 'min'], ['dat_priority', 'delete_min', ['_lv', 'p']]], ['var_set', ['_lv', 'max'], ['dat_priority', 'find_max', ['_lv', 'p']]],
  ]);
  assert.deepEqual([v.h, v.min, v.max], [1, 'a', 'c']);
});

test('local projects save to a "_"-prefixed partition', () => {
  const src = (slug: string, local?: boolean) => ({ krpj: { cfg_db_relay: { slug } } as never, url: (x: string) => x, local });
  assert.equal(partition(src('demo')), 'demo');
  assert.equal(partition(src('demo', true)), '_demo');
  assert.equal(partition(src('', true)), '_unpublished');
});

test('crashes are labelled by error kind (docs/error_audit.md)', async () => {
  const kind = (body: unknown[]) => exec(body).then(() => 'no error', errorKind);
  assert.match(await kind([['var_arr_get', ['var_arr_create', 1], 5]]), /^GML error/);
  assert.match(await kind([['var_arr_create', -1]]), /^unverified/);
  assert.match(await kind([['drw_texturegroup', 'no_such_member']]), /^not implemented/);
});

test('alpha test state reaches the renderer; show_message / show_question use the platform dialogs', async () => {
  const body = [
    ['drw_gpu', 'alphatestref', 128], ['drw_gpu', 'alphatestenable', true],
    ['sys_alert', 'hi'], ['var_set', ['_lv', 'q'], ['sys_confirm', 'sure?']],
  ];
  const calls: unknown[] = [], said: string[] = [];
  const p = createHeadless(() => [10, 10], undefined, undefined, { alert: (m) => { said.push(m); }, confirm: (m) => { said.push(m); return false; } });
  p.renderer.setAlphaTest = (on, ref) => { calls.push([on, ref]); };
  const g = await load({ krpj: project({ o: obj([['evt_create', body]]) }, [{ object: 'o', x: 0, y: 0 }]), url: (x) => x }, p);
  assert.deepEqual(calls, [[false, 128], [true, 128]]);
  assert.deepEqual([said, g.instances[0].vars.get(g.a.varSlot('q'))], [['hi', 'sure?'], false]);
  assert.equal((await exec(body)).q, true); // no dialogs: logged, answered yes
});

test('instance_copy copies variables (not array writes); instance_change swaps the object and runs its create', async () => {
  const pj = project({
    a: obj([['evt_create', [
      ['var_set', ['_ai', ['_lv', 'v'], 0], 1],
      ['var_set', ['_lv', 'c'], ['ins_copy', false]],
      ['var_set', ['_ai', ['_lv', 'v'], 0], 9],
      ['ins_change', ['_as', 'b'], true],
    ]]]),
    b: obj([['evt_create', [['var_set', ['_lv', 'changed'], true]]]]),
  }, [{ object: 'a', x: 3, y: 4 }]);
  const g = await load({ krpj: pj, url: (x) => x }, createHeadless(() => [10, 10]));
  const [a, c] = g.instances, v = (i: typeof a, k: string) => i.vars.get(g.a.varSlot(k));
  assert.deepEqual([g.instances.length, a.obj.name, v(a, 'changed'), v(a, 'v'), c.obj.name, c.x, v(c, 'v'), v(c, 'changed'), v(a, 'c')], [2, 'b', true, [9], 'a', 3, [1], undefined, c.id]);
});

test('move_contact / move_outside / move_bounce / place_snapped / mp_*_step against a solid (HTML5 runner behaviour)', async () => {
  const pj = project({
    wall: { ...obj([], 'spr_box'), solid: true },
    mover: obj([['evt_create', [
      ['mov_contact', 'solid', 0, 100], ['var_set', ['_lv', 'cx'], ['_lv', 'x']],
      ['var_set', ['_lv', 'snapped'], ['mov_is_snapped', 10, 10]],
      ['var_set', ['_lv', 'pot'], ['mov_mp_potential_step', 100, 0, 2, false]], ['var_set', ['_lv', 'potdir'], ['_lv', 'direction']],
      ['var_set', ['_lv', 'lin'], ['mov_mp_linear_step', 100, 0, 5, false]], ['var_set', ['_lv', 'lx'], ['_lv', 'x']],
      ['var_set', ['_lv', 'x'], 25], ['mov_outside', 'solid', 180, 100], ['var_set', ['_lv', 'ox'], ['_lv', 'x']],
      ['var_set', ['_lv', 'hspeed'], 5], ['mov_bounce', 'solid', false], ['var_set', ['_lv', 'bh'], ['_lv', 'hspeed']],
      ['var_set', ['_lv', 'near'], ['mov_mp_linear_step', 20, 3, 5, false]],
    ]]], 'spr_box'),
  }, [{ object: 'wall', x: 30, y: 0 }, { object: 'mover', x: 0, y: 0 }]);
  const g = await load({ krpj: pj, url: (x) => x }, createHeadless(() => [10, 10]));
  const m = g.instances[1], v = (k: string) => m.vars.get(g.a.varSlot(k));
  assert.deepEqual([v('cx'), v('snapped'), v('pot'), v('potdir'), v('lin'), v('lx'), v('ox'), v('bh'), v('near'), m.x, m.y], [20, true, false, 30, false, 20, 20, -5, true, 20, 3]);
});

test('instance_place_list (ordered by distance), rectangle_in_rectangle', async () => {
  const pj = project({
    wall: obj([], 'spr_box'),
    o: obj([['evt_create', [
      ['var_set', ['_lv', 'l'], ['dat_list_create']],
      ['var_set', ['_lv', 'n'], ['sen_instance_list', 'place', 0, 0, ['_as', 'wall'], ['_lv', 'l'], true]],
      ['var_set', ['_lv', 'first'], ['dat_list_get', ['_lv', 'l'], 0]],
      ['var_set', ['_lv', 'pos'], ['sen_instance_list', 'position', 6, 1, ['_kw', 'all'], ['_lv', 'l'], false]],
      ['var_set', ['_lv', 'r1'], ['opr_rect_in_rect', 0, 0, 5, 5, 0, 0, 10, 10]],
      ['var_set', ['_lv', 'r2'], ['opr_rect_in_rect', 5, 5, 0, 0, 3, 3, 10, 10]],
      ['var_set', ['_lv', 'r0'], ['opr_rect_in_rect', 0, 0, 1, 1, 5, 5, 6, 6]],
    ]]], 'spr_box'),
  }, [{ object: 'wall', x: 5, y: 0 }, { object: 'wall', x: 2, y: 0 }, { object: 'wall', x: 50, y: 0 }, { object: 'o', x: 0, y: 0 }]);
  const g = await load({ krpj: pj, url: (x) => x }, createHeadless(() => [10, 10]));
  const v = (k: string) => g.instances[3].vars.get(g.a.varSlot(k));
  assert.deepEqual([v('n'), v('first'), v('pos'), v('r1'), v('r2'), v('r0')], [2, g.instances[1].id, 3, 1, 2, 0]);
});

test('array_map / filter / find_index / any / all call back with (element, index)', async () => {
  const set = (k: number, x: number) => ['var_set', ['_ai', ['_lv', 'a'], k], x], it = (fn: string, f: string, ...more: number[]) => ['var_arr_iterate', fn, ['_lv', 'a'], ['_fn', f], ...more];
  const v = await execFn([
    set(0, 1), set(1, 2), set(2, 3),
    ['var_set', ['_lv', 'map'], it('map', 'dbl')], ['var_set', ['_lv', 'filter'], it('filter', 'big')], ['var_set', ['_lv', 'find'], it('find_index', 'big')],
    ['var_set', ['_lv', 'any'], it('any', 'big')], ['var_set', ['_lv', 'all'], it('all', 'big')], ['var_set', ['_lv', 'back'], it('map', 'dbl', -1, -2)],
  ], {
    dbl: { args: [], body: [['ctr_return', ['opr_add', ['opr_mul', ['_lv', 'argument0'], 2], ['_lv', 'argument1']]]] },
    big: { args: [], body: [['ctr_return', ['opr_gt', ['_lv', 'argument0'], 2]]] },
  }, ['dbl', 'big']);
  assert.deepEqual([v.map, v.filter, v.find, v.any, v.all, v.back], [[2, 5, 8], [3], 2, true, false, [8, 5]]);
});

test('file_bin_* round-trips bytes; file_find_* lists a directory by mask', async () => {
  const v = await exec([
    ['var_set', ['_lv', 'f'], ['dat_bin', 'open', 'Data/a.bin', 1]],
    ['dat_bin', 'write_byte', ['_lv', 'f'], 7], ['dat_bin', 'write_byte', ['_lv', 'f'], 265], ['dat_bin', 'close', ['_lv', 'f']],
    ['var_set', ['_lv', 'f'], ['dat_bin', 'open', 'data/a.bin', 0]],
    ['var_set', ['_lv', 'size'], ['dat_bin', 'size', ['_lv', 'f']]], ['dat_bin', 'seek', ['_lv', 'f'], 1],
    ['var_set', ['_lv', 'b1'], ['dat_bin', 'read_byte', ['_lv', 'f']]], ['var_set', ['_lv', 'eof'], ['dat_bin', 'read_byte', ['_lv', 'f']]],
    ['dat_bin', 'close', ['_lv', 'f']],
    ['var_set', ['_lv', 'missing'], ['dat_bin', 'open', 'nope.bin', 0]],
    ['var_set', ['_lv', 'first'], ['dat_file_find_first', 'data/*.bin', 0]], ['var_set', ['_lv', 'next'], ['dat_file_find_next']], ['dat_file_find_close'],
    ['var_set', ['_lv', 'none'], ['dat_file_find_first', '*.bin', 0]], ['var_set', ['_lv', 'dir'], ['dat_file_find_first', 'd?ta', 16]],
  ]);
  assert.deepEqual([v.size, v.b1, v.eof, v.missing, v.first, v.next, v.none, v.dir], [2, 9, 0, -1, 'a.bin', '', '', 'data']);
});

test('positional audio: emitters position their voices; vertex buffers submit as primitives', async () => {
  const p = createHeadless(() => [10, 10]), pans: number[][] = [];
  p.audio.setPanner = (_v, ...rest) => { pans.push(rest); };
  const pj = project({ o: obj([['evt_create', [
    ['var_set', ['_lv', 'e'], ['snd_3d', 'emitter_create']], ['snd_3d', 'emitter_position', ['_lv', 'e'], 5, 6, 7],
    ['var_set', ['_lv', 'v'], ['snd_play_on', ['_lv', 'e'], ['_as', 'snd'], false, 0]],
    ['var_set', ['_lv', 'none'], ['snd_play_on', 99, ['_as', 'snd'], false, 0]],
    ['var_set', ['_lv', 'ex'], ['snd_3d', 'emitter_get_x', ['_lv', 'e']]],
    ['snd_play_at', ['_as', 'snd'], 1, 2, 3, 50, 500, 1, false, 0],
    ['drw_vertex', 'format_begin'], ['drw_vertex', 'format_add_position'], ['drw_vertex', 'format_add_colour'], ['var_set', ['_lv', 'fmt'], ['drw_vertex', 'format_end']],
    ['var_set', ['_lv', 'vb'], ['drw_vertex', 'create_buffer']], ['drw_vertex', 'begin', ['_lv', 'vb'], ['_lv', 'fmt']],
    ...[[0, 0], [4, 0], [0, 4]].flatMap(([x, y]) => [['drw_vertex', 'position', ['_lv', 'vb'], x, y], ['drw_vertex', 'colour', ['_lv', 'vb'], 255, 1]]),
    ['drw_vertex', 'end', ['_lv', 'vb']], ['var_set', ['_lv', 'vn'], ['drw_vertex', 'get_number', ['_lv', 'vb']]],
    ['drw_vertex', 'submit', ['_lv', 'vb'], 4, -1],
  ]]]) }, [{ object: 'o', x: 0, y: 0 }]);
  pj.sounds = { snd: { name: 'snd', src: './snd.ogg', volume: 1, stream: false } } as Krpj['sounds'];
  const g = await load({ krpj: pj, url: (x) => x }, p);
  await new Promise((r) => setTimeout(r)); // sounds decode asynchronously; voices start once loaded
  const v = (k: string) => g.instances[0].vars.get(g.a.varSlot(k));
  assert.deepEqual([v('none'), v('ex'), v('vn'), p.stats.draws], [-1, 5, 3, 1]);
  assert.deepEqual(pans, [[5, 6, 7, 0, 100, 100000, 1], [1, 2, 3, 0, 50, 500, 1]]);
  g.snd.falloff = 3; g.snd.emitterChanged(null);
  assert.deepEqual(pans.slice(2).map((x) => x[3]), [2, 2]);
});
