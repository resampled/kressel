// Rooms (rom_*). Changes take effect at the end of the frame.

import { define } from './registry.ts';
import { GmlError, real } from '../value.ts';

define('rom_goto', (g, s, t) => { g.goto(real(s[t])); return undefined; });
define('rom_change', (g, s, t) => {
  const order = g.a.roomOrder, at = order.indexOf(g.roomIndex);
  switch (s[t]) {
    case 'restart': g.goto(g.roomIndex); break;
    case 'next': if (at + 1 >= order.length) throw new GmlError('room_goto_next: no next room'); g.goto(order[at + 1]); break;
    case 'previous': if (at <= 0) throw new GmlError('room_goto_previous: no previous room'); g.goto(order[at - 1]); break;
    default: throw new GmlError(`rom_change: unknown variant ${String(s[t])}`);
  }
  return undefined;
});
