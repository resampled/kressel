import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Op, T, VarKind, Ext, disassemble, type Instr } from '../src/decompile/disasm.ts';
import { Decompiler } from '../src/decompile/structure.ts';
import { decompileAll } from '../src/decompile/program.ts';
import type { GmModel } from '../src/model.ts';

// Builds instruction lists the way GM's compiler lays them out (4-byte words, addresses from 0).
type Spec = Partial<Instr> & { op: number };
const assets = { objects: ['obj_a', 'obj_b'], sprites: ['spr_a'], sounds: [], rooms: [], fonts: [] };

function decompile(specs: Spec[], names: typeof assets & { scripts?: Set<string> } = assets): unknown[] {
  let at = 0;
  const ins = specs.map((s): Instr => {
    const i: Instr = { at, t1: T.Int32, t2: T.Int32, i16: 0, b1: 0, target: -1, value: null, v: null, vkind: 0, fn: null, ...s };
    at += 4;
    return i;
  });
  // Branch targets are given as instruction indices; turn them into addresses.
  for (const i of ins) if (i.target >= 0) i.target *= 4;
  return new Decompiler('test', ins, at, names).run();
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

test('with (obj) { x = 0 }: pushenv jumps to the popenv, which loops back to the body', () => {
  assert.deepEqual(decompile([pushi(1), { op: Op.pushenv, target: 4 }, pushi(0), pop('x'), { op: Op.popenv, target: 2 }]), [
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

const b = (op: number, target: number): Spec => ({ op, target });
const dupv: Spec = { op: Op.dup, t1: T.Var, i16: 0 };

test('switch with fall-through, break and default (GM layout: case tests, then bodies, then popz)', () => {
  // switch (s) { case 1: a = 1; break; case 2: default: a = 2; }
  assert.deepEqual(decompile([
    pushv('s'), dupv, pushi(1), cmp(3), b(Op.bt, 10), dupv, pushi(2), cmp(3), b(Op.bt, 13), b(Op.b, 13),
    pushi(1), pop('a'), b(Op.b, 15), pushi(2), pop('a'), { op: Op.popz, t1: T.Var },
  ]), [['ctr_switch', ['_lv', 's'], [
    ['ctr_case', 1], ['var_set', ['_lv', 'a'], 1], ['ctr_break'], ['ctr_case', 2], ['ctr_default'], ['var_set', ['_lv', 'a'], 2],
  ]]]);
});

test('flat && chains share one false label', () => {
  // if (a && b && c) x = 1
  assert.deepEqual(decompile([
    pushv('a'), b(Op.bf, 6), pushv('b'), b(Op.bf, 6), pushv('c'), b(Op.b, 7), pushi(0), b(Op.bf, 10), pushi(1), pop('x'),
  ]), [['ctr_if', ['opr_and', ['opr_and', ['_lv', 'a'], ['_lv', 'b']], ['_lv', 'c']], [['var_set', ['_lv', 'x'], 1]]]]);
});

test('repeat', () => {
  // repeat (3) x += 1
  assert.deepEqual(decompile([
    pushi(3), { op: Op.dup, t1: T.Int32, i16: 0 }, pushi(0), cmp(2), b(Op.bt, 14),
    pushv('x'), pushi(1), { op: Op.add }, pop('x'),
    { op: Op.push, t1: T.Int32, value: 1 }, { op: Op.sub }, { op: Op.dup, t1: T.Int32, i16: 0 }, { op: Op.conv, t1: T.Int32, t2: T.Bool }, b(Op.bt, 5),
    { op: Op.popz, t1: T.Int32 },
  ]), [['ctr_repeat', 3, [['var_change', '+', ['_lv', 'x'], 1]]]]);
});

test('for loop: continue jumps to the step', () => {
  // for (i = 0; i < 3; i += 1) { if (i == 1) continue; n += 1 }
  assert.deepEqual(decompile([
    pushi(0), pop('i'), pushv('i'), pushi(3), cmp(1), b(Op.bf, 20),
    pushv('i'), pushi(1), cmp(3), b(Op.bf, 11), b(Op.b, 15),
    pushv('n'), pushi(1), { op: Op.add }, pop('n'),
    pushv('i'), pushi(1), { op: Op.add }, pop('i'), b(Op.b, 2),
  ]), [
    ['var_set', ['_lv', 'i'], 0],
    ['ctr_for', [], ['opr_lt', ['_lv', 'i'], 3], [['var_change', '+', ['_lv', 'i'], 1]], [
      ['ctr_if', ['opr_eq', ['_lv', 'i'], 1], [['ctr_continue']]], ['var_change', '+', ['_lv', 'n'], 1],
    ]],
  ]);
});

test('method calls (callv) and 2D array writes (popaf)', () => {
  // inst.f(1)
  assert.deepEqual(decompile([pushi(1), pushv('inst'), { op: Op.dup, t1: T.Var, i16: 0 }, pushv('f', -9, VarKind.normal), { op: Op.callv, i16: 1 }, { op: Op.popz }]), [
    ['fnc_m', ['_iv', ['_lv', 'inst'], 'f'], 1],
  ]);
  // a[1][2] = 5
  assert.deepEqual(decompile([pushi(5), pushi(-1), pushi(1), pushv('a', 0, VarKind.popaf), pushi(2), { op: Op.brk, i16: Ext.popaf }]), [
    ['var_set', ['_ai', ['_ai', ['_lv', 'a'], 1], 2], 5],
  ]);
});

// Pre-2.3 (bytecode 16) code: scripts are called by name, 2D arrays are one index i * 32000 + j.
const pre23 = { ...assets, scripts: new Set(['scr_hurt']) };
const chk: Spec = { op: Op.brk, i16: Ext.chkindex };

test('pre-2.3: a[i, j] (i; chkindex; 32000; mul; j; chkindex; add) reads as a[i][j]', () => {
  // a[1, 2] = 5
  const write = [pushi(5), pushi(-1), pushi(1), chk, { op: Op.push, t1: T.Int32, value: 32000 }, { op: Op.mul }, pushi(2), chk, { op: Op.add }, pop('a', 0, VarKind.array)];
  assert.deepEqual(decompile(write, pre23), [['var_set', ['_ai', ['_ai', ['_lv', 'a'], 1], 2], 5]]);
  // GMS2.3 code can mean that index literally.
  assert.deepEqual(decompile(write), [['var_set', ['_ai', ['_lv', 'a'], ['opr_add', ['opr_mul', 1, 32000], 2]], 5]]);
});

test('pre-2.3: scripts are called by their name', () => {
  assert.deepEqual(decompile([pushi(3), call('scr_hurt', 1), { op: Op.popz }], pre23), [['fnc_g', 'scr_hurt', 3]]);
});

test('a call left on the stack before an if is a statement (popz omitted by the mod compiler)', () => {
  // f(); if (x) g();  -- with no popz after f()
  assert.deepEqual(decompile([call('instance_destroy', 0), pushv('x'), { op: Op.bf, target: 5 }, call('instance_destroy', 0), { op: Op.popz }]), [
    ['ins_destroy'], ['ctr_if', ['_lv', 'x'], [['ins_destroy']]],
  ]);
});

test('pre-2.3: an empty script (zero-length entry at the next script\'s address) does not swallow that script', () => {
  // instance_destroy(); as call.i + function ref + popz.v, shared by gml_Script_empty (length 0) and gml_Script_real.
  const buf = new ArrayBuffer(12), dv = new DataView(buf);
  dv.setUint32(0, (Op.call << 24) | (T.Int32 << 16), true);
  dv.setUint32(8, (Op.popz << 24) | (T.Var << 16), true);
  const entry = (name: string, length: number) => ({ name, start: 0, length, offset: 0, locals: 0, args: 0 });
  const m = {
    buf, code: [entry('gml_Script_empty', 0), entry('gml_Script_real', 12)], strings: [],
    refs: { vars: new Map(), funcs: new Map([[0, 'instance_destroy']]) },
    objects: [], sprites: [], sounds: [], rooms: [], fonts: [], scripts: [], fmt: { gms23: false },
  } as unknown as GmModel;
  const out = decompileAll(m);
  assert.deepEqual([out.get('gml_Script_empty')?.body, out.get('gml_Script_real')?.body], [[], [['ins_destroy']]]);
});

test('++x / x++ used as values become var_inc reporters (prefix: dup after add; postfix: dup before)', () => {
  // y = ++x
  assert.deepEqual(decompile([pushv('x'), pushi(1), { op: Op.add, t2: T.Var }, { op: Op.dup, t1: T.Var, i16: 0 }, pop('x'), pop('y')]), [
    ['var_set', ['_lv', 'y'], ['var_inc', ['_lv', 'x']]],
  ]);
  // y = x--
  assert.deepEqual(decompile([pushv('x'), { op: Op.dup, t1: T.Var, i16: 0 }, pushi(1), { op: Op.sub, t2: T.Var }, pop('x'), pop('y')]), [
    ['var_set', ['_lv', 'y'], ['var_dec', ['_lv', 'x'], true]],
  ]);
});

test('instance access kind 0xe0 names a room instance by id - 100000 (Ch2 room_dw_cyber_teacup_final)', () => {
  assert.deepEqual(decompile([pushv('y', 2269, VarKind.instance), pop('endY')]), [['var_set', ['_lv', 'endY'], ['_iv', 102269, 'y']]]);
});

test('return inside with: the popenv exit form before ret is bookkeeping', () => {
  // with (obj_b) { return 5 }  ->  pushi 1; pushenv E; pushi 5; popenv <exit>; ret; E: popenv body
  assert.deepEqual(decompile([pushi(1), { op: Op.pushenv, target: 5 }, pushi(5), { op: Op.popenv, target: -1 }, { op: Op.ret }, { op: Op.popenv, target: 2 }]), [
    ['ctr_with', ['_as', 'obj_b'], [['ctr_return', 5]]],
  ]);
});

test('exit inside repeat pops the repeat counter first', () => {
  // repeat (3) { if (a) exit; }
  assert.deepEqual(decompile([
    pushi(3), { op: Op.dup, t1: T.Int32, i16: 0 }, pushi(0), cmp(2), { op: Op.bt, target: 14 },
    pushv('a'), { op: Op.bf, target: 9 }, { op: Op.popz, t1: T.Int32 }, { op: Op.exit },
    pushi(1), { op: Op.sub }, { op: Op.dup, t1: T.Int32, i16: 0 }, { op: Op.conv, t2: T.Bool }, { op: Op.bt, target: 5 }, { op: Op.popz, t1: T.Int32 },
  ]), [['ctr_repeat', 3, [['ctr_if', ['_lv', 'a'], [['ctr_exit']]]]]]);
});

test('a last `if (c) exit;` keeps its exit (the branch targets the end of the entry)', () => {
  assert.deepEqual(decompile([pushv('a'), { op: Op.bf, target: 3 }, { op: Op.exit }]), [['ctr_if', ['_lv', 'a'], [['ctr_exit']]]]);
});

test('try / catch (Ch2 obj_tensionbar Draw)', () => {
  // try { x = 1 } catch (_ex) { x = 2 }
  assert.deepEqual(decompile([
    pushi(40), pushi(16), call('@@try_hook@@', 2), { op: Op.popz },
    pushi(1), pop('x'), { op: Op.b, target: 15 },
    pop('_ex', -7), call('@@try_unhook@@', 0), { op: Op.popz }, pushi(2), pop('x'), call('@@finish_catch@@', 0), { op: Op.popz }, { op: Op.b, target: 17 },
    call('@@try_unhook@@', 0), { op: Op.popz },
  ]), [['var_local', '_ex'], ['ctr_try', [['var_set', ['_lv', 'x'], 1]], '_ex', [['var_set', ['_lv', 'x'], 2]]]]);
});

test('popenv\'s exit form is operand 0xf00000 (24 bits)', () => {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, ((Op.popenv << 24) | 0xf00000) >>> 0, true);
  const [i] = disassemble(buf, { name: 't', start: 0, length: 4, offset: 0, locals: 0, args: 0 }, { vars: new Map(), funcs: new Map() }, []);
  assert.equal(i.target, -1);
});

test('static block: isstaticok; bt E; static.k = v; E: setstatic  ->  var_static (DR ch3 Vector2)', () => {
  assert.deepEqual(decompile([
    { op: Op.brk, i16: Ext.isstaticok }, b(Op.bt, 4), pushi(3), pop('k', -16), { op: Op.brk, i16: Ext.setstatic }, pushi(1), pop('a'),
  ]), [['var_static', 'k', 3], ['var_set', ['_lv', 'a'], 1]]);
});

test('switch whose default starts with popz (default: exit) is told apart by the dead b to the end (DR ch3 chefs)', () => {
  // switch (s) { default: exit; case 0: a = 1; break; }
  assert.deepEqual(decompile([
    pushv('s'), dupv, pushi(0), cmp(3), b(Op.bt, 9), b(Op.b, 7), b(Op.b, 12), { op: Op.popz, t1: T.Var }, { op: Op.exit },
    pushi(1), pop('a'), b(Op.b, 12), { op: Op.popz, t1: T.Var },
  ]), [['ctr_switch', ['_lv', 's'], [['ctr_default'], ['ctr_exit'], ['ctr_case', 0], ['var_set', ['_lv', 'a'], 1]]]]);
});

test('break inside with jumps to an extra exit-form popenv (DR ch3 shutta photo controller)', () => {
  // with (obj_b) { break; } a = 1;
  assert.deepEqual(decompile([
    pushi(1), { op: Op.pushenv, target: 3 }, b(Op.b, 5), { op: Op.popenv, target: 2 }, b(Op.b, 6), { op: Op.popenv, target: -1 }, pushi(1), pop('a'),
  ]), [['ctr_with', ['_as', 'obj_b'], [['ctr_break']]], ['var_set', ['_lv', 'a'], 1]]);
});

test('a bare other; left on the stack is dropped; built-ins pushed as values become _fn opcodes', () => {
  assert.deepEqual(decompile([call('@@Other@@', 0), pushi(0), call('event_user', 1), { op: Op.popz }]), decompile([pushi(0), call('event_user', 1), { op: Op.popz }]));
  assert.deepEqual(decompile([{ op: Op.push, t1: T.Int32, fn: 'variable_instance_set', value: 0 }, pop('f')]), [['var_set', ['_lv', 'f'], ['_fn', 'var_inst_set']]]);
});
