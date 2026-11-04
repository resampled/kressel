// GEN8: general game info. Layout per UndertaleModTool's UndertaleGeneralInfo.
// Verified against a GM 2024 (bytecode 17) data.win.

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
  displayName: string;
  /** Room indices in game order; the first is the starting room. Empty if GEN8 is truncated. */
  roomOrder: number[];
  /** GMS2 game speed (frames per second), or 0 when not stored (GMS1 uses room speed). */
  fps: number;
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
  const g: Gen8 = { debuggerDisabled, bytecodeVersion, fileName, config, gameId, name, version,
    windowWidth: r.u32(), windowHeight: r.u32(), displayName: '', roomOrder: [], fps: 0 };
  if (r.pos === r.end) return g; // minimal GEN8 (synthetic tests)

  r.skip(4 + 4 + 16 + 8); // info flags, license CRC32, license MD5, timestamp
  g.displayName = r.strPtr();
  r.skip(8 + 8 + 4); // active targets, function classifications, steam app id
  if (bytecodeVersion >= 14) r.skip(4); // debugger port
  const n = r.count(10000);
  for (let i = 0; i < n; i++) g.roomOrder.push(r.u32());
  if (version[0] >= 2 && r.end - r.pos >= 40 + 24) {
    r.skip(40); // random UID block (5 x u64)
    g.fps = r.f32();
  }
  return g;
}
