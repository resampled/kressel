// Sensing (sen_*): input and collisions.

import { define } from './registry.ts';
import { real } from '../value.ts';

/** vk_anykey (1) / vk_nokey (0) / a key code. */
function key(keys: Uint8Array, code: number): boolean {
  if (code > 1) return code < keys.length && keys[code] !== 0;
  let any = false;
  for (let i = 2; i < keys.length; i++) if (keys[i]) { any = true; break; }
  return code === 1 ? any : !any;
}

define('sen_key_held', (g, s, t) => key(g.p.input.keys, real(s[t])));
define('sen_key_pressed', (g, s, t) => key(g.p.input.pressed, real(s[t])));
define('sen_key_released', (g, s, t) => key(g.p.input.released, real(s[t])));

define('sen_place_meeting', (g, s, t) => g.placeMeeting(g.self, real(s[t]), real(s[t - 1]), real(s[t - 2])) !== null);
define('sen_instance_place', (g, s, t) => g.placeMeeting(g.self, real(s[t]), real(s[t - 1]), real(s[t - 2]))?.id ?? -4);
