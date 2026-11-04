import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Krpj, Script } from '../src/krpj.ts';
import { createHeadless } from '../src/platform/headless.ts';
import { load } from '../src/play.ts';
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
  return Object.fromEntries(g.a.varNames.map((n, i) => [n, inst.vars[i]]));
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
  assert.equal(m.vars[slot('rang')], true);
  assert.ok((m.vars[slot('hits')] as number) >= 1);
  assert.equal(w.vars[slot('touched')], true);
});
