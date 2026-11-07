// Parses docs/krpj_opcodes.md into opcode definitions, and renders krplayer/src/opcodes.gen.ts.
// The doc is the source of truth: edit it, then run `pnpm gen:opcodes`.

export interface ParsedOpcode { name: string; flags: string[]; args: string | null; gml: string | null }

const NAMES = /^\* ((?:`[a-z0-9_]+`(?: \/ )?)+)(.*)$/; // * `a` / `b` (flags) - text
const ROW = /^\| `([a-z0-9_]+)`/;
const ARG = /^> \* (\w+) arg\d+( \(optional\))?/; // > * any arg1 (optional) = ...

function flagsOf(text: string): string[] {
  const m = /^\s*\(([^)]*)\)/.exec(text);
  const flags = m ? m[1].split(',').map((s) => s.trim()) : [];
  if (/^(\s*\([^)]*\))?\s*- cap\b/.test(text)) flags.push('cap');
  return flags;
}

export function parseOpcodes(md: string): ParsedOpcode[] {
  const out: ParsedOpcode[] = [];
  let header: string[] = [];
  let bullet: ParsedOpcode[] = []; // opcodes of the current bullet, collecting `> * kind argN` lines
  let inCode = false;

  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('```')) inCode = !inCode;
    if (inCode) continue;
    if (line.startsWith('## Unsupported')) break; // GML names with no opcode

    const arg = ARG.exec(line);
    if (arg && bullet.length) {
      const a = arg[1] + (arg[2] ? '?' : '');
      for (const op of bullet) op.args = op.args ? `${op.args}, ${a}` : a;
      continue;
    }
    if (!line.startsWith('>')) bullet = [];

    const names = NAMES.exec(line);
    if (names) {
      const flags = flagsOf(names[2]);
      bullet = [...names[1].matchAll(/`([a-z0-9_]+)`/g)].map((m) => ({ name: m[1], flags: [...flags], args: null, gml: null }));
      out.push(...bullet);
      continue;
    }

    if (!line.startsWith('|')) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    const row = ROW.exec(line);
    if (!row) { if (!/^\|[-| ]+\|$/.test(line)) header = cells; continue; }
    if (header[0] !== 'Opcode') continue;
    const col = (h: string) => { const i = header.indexOf(h); return i < 0 ? null : cells[i] || null; };
    out.push({ name: row[1], flags: flagsOf(cells[0].replace(/^`[a-z0-9_]+`/, '')), args: col('Arguments'), gml: col('GML') });
  }
  return out;
}

export function renderOpcodes(ops: ParsedOpcode[]): string {
  const rows = ops.map((o) => `  ${JSON.stringify(o)},`).join('\n');
  return `// GENERATED from docs/krpj_opcodes.md by scripts/gen-opcodes.ts. Do not edit; run \`pnpm gen:opcodes\`.\n` +
    `import type { OpcodeDef } from './opcodes.ts';\n\n` +
    `export const OPCODES: readonly OpcodeDef[] = [\n${rows}\n];\n`;
}

/** Plain-JS copy for kreditor (no build step), written to kreditor/mockup/src/opcodes.gen.js. */
export function renderOpcodesJs(ops: ParsedOpcode[]): string {
  const rows = ops.map((o) => `  ${JSON.stringify(o)},`).join('\n');
  return `// GENERATED from docs/krpj_opcodes.md by scripts/gen-opcodes.ts. Do not edit; run \`pnpm gen:opcodes\`.\n` +
    `export const OPCODES = [\n${rows}\n];\n`;
}
