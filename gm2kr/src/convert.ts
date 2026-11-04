// data.win -> { game.krpj, sprites/..., fonts/... }. The whole pipeline, with no DOM (runs in Node too).

import { readModel } from './model.ts';
import { emitKrpj, type Converted } from './emit/krpj.ts';

export function convert(dataWin: ArrayBuffer): Promise<Converted> {
  return emitKrpj(readModel(dataWin));
}
