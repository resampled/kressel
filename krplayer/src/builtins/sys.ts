// System (sys_*).

import { define } from './registry.ts';
import { str } from '../value.ts';

define('sys_log', (_g, s, t) => { console.log(str(s[t])); return undefined; });
define('sys_game_end', (g) => { g.ended = true; return undefined; });
