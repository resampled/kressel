import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Krpj, Script } from '../src/krpj.ts';
import { createHeadless } from '../src/platform/headless.ts';
import { load, prepare } from '../src/play.ts';
import { equals, str, add } from '../src/value.ts';

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
