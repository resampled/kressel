// data.win (+ the rest of the game folder) -> { game.json, sprites/..., sounds/... }. The whole
// pipeline, with no DOM (runs in Node too).

import { readModel } from './model.ts';
import { emitKrpj, type Converted, type GameFiles, type Progress } from './emit/krpj.ts';

export type { GameFiles, Progress };

export function convert(dataWin: ArrayBuffer, extra?: GameFiles, log?: (msg: string) => void, progress?: Progress): Promise<Converted> {
  progress?.('Reading data.win', 0, 1);
  return emitKrpj(readModel(dataWin), extra, log, progress);
}
