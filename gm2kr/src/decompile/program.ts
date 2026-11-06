// All code entries -> script trees. GMS2.3+ stores functions as child entries inside their parent's
// bytecode block (offset > 0); the parent jumps over each child's body. A block is disassembled once,
// then the parent and every child are decompiled from their own instruction ranges.

import type { GmModel } from '../model.ts';
import { disassemble, Op } from './disasm.ts';
import { Decompiler, DecompileError, type AssetNames, type Kr } from './structure.ts';

export interface Decompiled {
  body: Kr[];
  /** Declared argument count (functions). */
  args: number;
  /** Child entry (a function defined inside another entry's block). */
  child: boolean;
}

export function assetNames(m: GmModel): AssetNames {
  return {
    objects: m.objects.map((o) => o.name), sprites: m.sprites.map((s) => s.name), sounds: m.sounds.map((s) => s.name),
    rooms: m.rooms.map((r) => r.name), fonts: m.fonts.map((f) => f.name),
    ...(m.fmt.gms23 ? {} : { scripts: new Set(m.scripts.map((s) => s.name)) }),
  };
}

/**
 * Decompiles every code entry, keyed by entry name. With onError, failures are reported and
 * skipped (for surveying a game); without it, the first failure throws.
 */
export function decompileAll(m: GmModel, onError?: (name: string, e: Error) => void): Map<string, Decompiled> {
  const assets = assetNames(m), out = new Map<string, Decompiled>();
  const blocks = new Map<number, typeof m.code>();
  for (const c of m.code) (blocks.get(c.start) ?? blocks.set(c.start, []).get(c.start)!).push(c);
  for (const entries of blocks.values()) {
    const head = entries.find((c) => c.offset === 0) ?? entries[0];
    let ins;
    try { ins = disassemble(m.buf, head, m.refs, m.strings); } catch (e) {
      if (!onError) throw e;
      for (const c of entries) onError(c.name, e as Error);
      continue;
    }
    const childStarts = new Set(entries.filter((c) => c.offset > 0).map((c) => head.start + c.offset));
    for (const c of entries) {
      try {
        const d = new Decompiler(c.name, ins, head.start + head.length, assets, childStarts);
        if (c.offset === 0) { out.set(c.name, { body: d.run(), args: c.args, child: false }); continue; }
        // The parent's `b` just before the child jumps over its body: that's where the child ends.
        const from = d.index(head.start + c.offset), skip = ins[from - 1];
        if (!skip || skip.op !== Op.b || skip.target <= skip.at) throw new DecompileError(`${c.name}: child function is not preceded by a jump over it`);
        out.set(c.name, { body: d.run(from, d.index(skip.target)), args: c.args, child: true });
      } catch (e) {
        if (!onError) throw e;
        onError(c.name, e as Error);
      }
    }
  }
  return out;
}
