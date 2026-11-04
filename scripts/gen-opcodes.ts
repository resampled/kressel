import { readFileSync, writeFileSync } from 'node:fs';
import { parseOpcodes, renderOpcodes } from './opcodes-md.ts';

const root = new URL('../', import.meta.url);
const ops = parseOpcodes(readFileSync(new URL('docs/krpj_opcodes.md', root), 'utf8'));
writeFileSync(new URL('krplayer/src/opcodes.gen.ts', root), renderOpcodes(ops));
console.log(`opcodes.gen.ts: ${ops.length} opcodes`);
