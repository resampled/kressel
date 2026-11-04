// Format detection, done once. Chunk parsers branch on these flags, never on raw version numbers.
//
// GEN8's version is unreliable for GMS2 (often 2.0.0.0), so newer versions are inferred from
// which chunks exist and, later, from layout probes inside chunks (as UndertaleModTool does).
// Add a flag here when a parser needs one, with a comment saying how it is detected.

import type { Chunk } from './datawin.ts';
import type { Gen8 } from './chunks/gen8.ts';
import { FormatError } from './io/reader.ts';

export interface GmFormat {
  bytecode: number;
  /** GameMaker Studio 2 or later. */
  gms2: boolean;
  /** GMS 2.3+ (functions, structs, sequences). Detected by the SEQN chunk. */
  gms23: boolean;
  /** GM 2022.1+: room layers carry filter/effect fields. Detected by chunks added in 2022.x (FEAT/FEDS). */
  layerEffects: boolean;
}

const SUPPORTED_BYTECODE = [15, 16, 17];

export function detectFormat(gen8: Gen8, chunks: Chunk[]): GmFormat {
  const has = (n: string) => chunks.some((c) => c.name === n);
  const bytecode = gen8.bytecodeVersion;
  if (!SUPPORTED_BYTECODE.includes(bytecode)) {
    throw new FormatError(`unsupported bytecode version ${bytecode} (supported: ${SUPPORTED_BYTECODE.join(', ')})`, 1);
  }
  const gms23 = has('SEQN');
  return { bytecode, gms2: gms23 || gen8.version[0] >= 2, gms23, layerEffects: has('FEAT') || has('FEDS') };
}
