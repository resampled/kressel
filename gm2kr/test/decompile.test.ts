import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Op, T, VarKind, Ext, type Instr } from '../src/decompile/disasm.ts';
import { Decompiler } from '../src/decompile/structure.ts';

// Builds instruction lists the way GM's compiler lays them out (4-byte words, addresses from 0).
type Spec = Partial<Instr> & { op: number };
const assets = { objects: ['obj_a', 'obj_b'], sprites: ['spr_a'], sounds: [], rooms: [], fonts: [] };

function decompile(specs: Spec[]): unknown[] {
  let at = 0;
  const ins = specs.map((s): Instr => {
    const i: Instr = { at, t1: T.Int32, t2: T.Int32, i16: 0, b1: 0, target: -1, value: null, v: null, vkind: 0, fn: null, ...s };
    at += 4;
    return i;
  });
  // Branch targets are given as instruction indices; turn them into addresses.
  for (const i of ins) if (i.target >= 0) i.target *= 4;
  return new Decompiler('test', ins, at, assets).run();
}

const pushi = (v: number): Spec => ({ op: Op.pushi, t1: T.Int16, value: v, i16: v });
const pushv = (name: string, inst = -1, vkind: number = VarKind.normal): Spec => ({ op: Op.push, t1: T.Var, i16: inst, v: { name, instType: inst, id: 0 }, vkind });
const pop = (name: string, inst = -1, vkind: number = VarKind.normal, t1: number = T.Var): Spec => ({ op: Op.pop, t1, t2: T.Var, i16: inst, v: { name, instType: inst, id: 0 }, vkind });
const call = (fn: string, argc: number): Spec => ({ op: Op.call, fn, i16: argc });
const cmp = (kind: number): Spec => ({ op: Op.cmp, b1: kind });

test('assignment, call arguments are popped first-to-last', () => {
  assert.deepEqual(decompile([pushv('y'), pushv('x'), call('place_meeting', 2), { op: Op.popz }]), [
    ['sen_place_meeting', ['_lv', 'x'], ['_lv', 'y']],
  ]);
});

test('if / else', () => {
  // if (x > 1) a = 1 else a = 2
  assert.deepEqual(decompile([pushv('x'), pushi(1), cmp(6), { op: Op.bf, target: 7 }, pushi(1), pop('a'), { op: Op.b, target: 9 }, pushi(2), pop('a')]), [
    ['ctr_if', ['opr_gt', ['_lv', 'x'], 1], [['var_set', ['_lv', 'a'], 1]], [['var_set', ['_lv', 'a'], 2]]],
  ]);
});

test('&& short-circuit and while', () => {
  // while (a && b) x = x + 1
  assert.deepEqual(decompile([
    pushv('a'), { op: Op.bf, target: 4 }, pushv('b'), { op: Op.b, target: 5 }, pushi(0),
    { op: Op.bf, target: 11 }, pushv('x'), pushi(1), { op: Op.add }, pop('x'), { op: Op.b, target: 0 },
  ]), [['ctr_while', ['opr_and', ['_lv', 'a'], ['_lv', 'b']], [['var_change', '+', ['_lv', 'x'], 1]]]]);
});

test('do / until with a backward conditional branch', () => {
  assert.deepEqual(decompile([pushi(1), pop('x'), pushv('x'), { op: Op.bf, target: 0 }]), [
    ['ctr_do_until', [['var_set', ['_lv', 'x'], 1]], ['_lv', 'x']],
  ]);
});

test('with (obj) { x = 0 }', () => {
  assert.deepEqual(decompile([pushi(1), { op: Op.pushenv, target: 5 }, pushi(0), pop('x'), { op: Op.popenv, target: 2 }]), [
    ['ctr_with', ['_as', 'obj_b'], [['var_set', ['_lv', 'x'], 0]]],
  ]);
});

test('dup + stacktop compound assignment becomes var_change; @@Other@@ is other', () => {
  // obj_a._n += 5  (pushref obj_a; pushi -9; dup; push stacktop; ...; pop.i.v stacktop)
  assert.deepEqual(decompile([
    { op: Op.brk, i16: Ext.pushref, value: 0 }, pushi(-9), { op: Op.dup, t1: T.Int32, i16: 4 },
    pushv('_n', 0, VarKind.stacktop), pushi(5), { op: Op.add, t2: T.Var }, pop('_n', 0, VarKind.stacktop, T.Int32),
    call('@@Other@@', 0), call('instance_destroy', 1), { op: Op.popz },
  ]), [
    ['var_change', '+', ['_iv', ['_as', 'obj_a'], '_n'], 5],
    ['ins_destroy', ['_kw', 'other']],
  ]);
});

test('array element assignment on another instance', () => {
  // obj_b.alarm[0] = 120
  assert.deepEqual(decompile([pushi(120), { op: Op.brk, i16: Ext.pushref, value: 1 }, pushi(-9), pushi(0), pop('alarm', 0, VarKind.array)]), [
    ['var_set', ['_ai', ['_iv', ['_as', 'obj_b'], 'alarm'], 0], 120],
  ]);
});

test('unknown functions and unstructured branches fail loudly with the address', () => {
  assert.throws(() => decompile([call('nope_function', 0), { op: Op.popz }]), /test @0x0: unknown function nope_function/);
  assert.throws(() => decompile([{ op: Op.b, target: 2 }, pushi(0), { op: Op.popz }]), /test @0x0: unstructured branch/);
});
