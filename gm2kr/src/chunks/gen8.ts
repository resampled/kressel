// GEN8: general game info. Layout per UndertaleModTool's UndertaleGeneralInfo (first fields only).
// TODO: verify against real data.win files once samples/ has some.

import type { Reader } from '../io/reader.ts';

export interface Gen8 {
  debuggerDisabled: boolean;
  bytecodeVersion: number;
  fileName: string;
  config: string;
  gameId: number;
  name: string;
  /** As stored. GMS2 games often say 2.0.0.0 whatever the real IDE version; see format.ts. */
  version: [major: number, minor: number, release: number, build: number];
  windowWidth: number;
  windowHeight: number;
}

export function readGen8(r: Reader): Gen8 {
  const debuggerDisabled = r.u8() !== 0;
  const bytecodeVersion = r.u8();
  r.skip(2);
  const fileName = r.strPtr();
  const config = r.strPtr();
  r.skip(8); // last object id, last tile id
  const gameId = r.u32();
  r.skip(16); // DirectPlay GUID
  const name = r.strPtr();
  const version: Gen8['version'] = [r.u32(), r.u32(), r.u32(), r.u32()];
  return { debuggerDisabled, bytecodeVersion, fileName, config, gameId, name, version, windowWidth: r.u32(), windowHeight: r.u32() };
}
