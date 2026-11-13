import { readFileSync, writeFileSync } from 'node:fs';
import { parseOpcodes, renderOpcodes, renderOpcodesJs } from './opcodes-md.ts';

const root = new URL('../', import.meta.url);
const ops = parseOpcodes(readFileSync(new URL('docs/krpj_opcodes.md', root), 'utf8'));
writeFileSync(new URL('krplayer/src/opcodes.gen.ts', root), renderOpcodes(ops));
writeFileSync(new URL('kreditor/mockup/src/opcodes.gen.js', root), renderOpcodesJs(ops));
writeFileSync(new URL('kreditor/_static/opcodes.gen.js', root), renderOpcodesJs(ops, false));
console.log(`opcodes.gen.ts + kreditor opcodes.gen.js: ${ops.length} opcodes`);
