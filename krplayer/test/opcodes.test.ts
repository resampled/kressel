import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OPCODES, opcodeId } from '../src/opcodes.ts';
import { parseOpcodes, renderOpcodes, renderOpcodesJs } from '../../scripts/opcodes-md.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('opcodes.gen.ts is up to date with docs/krpj_opcodes.md (run pnpm gen:opcodes)', () => {
  const ops = parseOpcodes(read('../../docs/krpj_opcodes.md'));
  assert.equal(read('../src/opcodes.gen.ts'), renderOpcodes(ops));
  assert.equal(read('../../kreditor/src/opcodes.gen.js'), renderOpcodesJs(ops));
});

test('opcode names are unique and prefixed', () => {
  const names = OPCODES.map((o) => o.name);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
  for (const n of names) assert.match(n, /^(_[a-z0-9]+|[a-z]{3}_[a-z0-9_]+)$/, n);
});

test('parser picks up flags, args and GML names', () => {
  const by = (n: string) => OPCODES[opcodeId(n, 'test')];
  assert.deepEqual(by('ctr_break').flags, ['cap']);
  assert.deepEqual(by('drw_part').flags, ['hidden', 'family']);
  assert.equal(by('ins_create_layer').gml, '`instance_create_layer`');
  assert.equal(by('ctr_if').args, 'any, script, script?');
});

test('unknown opcodes fail loudly with location', () => {
  assert.throws(() => opcodeId('nope_nope', 'obj_player/evt_step@3'), /unknown opcode "nope_nope" at obj_player\/evt_step@3/);
});
