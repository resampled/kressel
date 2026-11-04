// Operators (functions): randomness and conversions (opr_*).

import { define } from './registry.ts';
import { real, str } from '../value.ts';

define('opr_random', (g, s, t) => g.random() * real(s[t]));
define('opr_random_range', (g, s, t) => { const a = real(s[t]); return a + g.random() * (real(s[t - 1]) - a); });
define('opr_irandom', (g, s, t) => Math.floor(g.random() * (Math.floor(real(s[t])) + 1)));
define('opr_string', (_g, s, t) => str(s[t]));
