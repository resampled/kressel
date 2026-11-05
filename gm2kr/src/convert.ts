// data.win (+ the rest of the game folder) -> { game.json, sprites/..., sounds/... }. The whole
// pipeline, with no DOM (runs in Node too).

import { readModel } from './model.ts';
import { emitKrpj, type Converted, type GameFiles } from './emit/krpj.ts';

export type { GameFiles };

export function convert(dataWin: ArrayBuffer, extra?: GameFiles, log?: (msg: string) => void): Promise<Converted> {
  return emitKrpj(readModel(dataWin), extra, log);
}
