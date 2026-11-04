// Movement (mov_*).

import { define } from './registry.ts';
import { real, truthy } from '../value.ts';

const D2R = Math.PI / 180;

define('mov_motion_set', (g, s, t) => { g.self.setDirection(real(s[t])); g.self.setSpeed(real(s[t - 1])); return undefined; });

define('mov_motion_add', (g, s, t) => {
  const i = g.self, d = real(s[t]) * D2R, v = real(s[t - 1]);
  i.setHV(i.hspeed + v * Math.cos(d), i.vspeed - v * Math.sin(d));
  return undefined;
});

define('mov_wrap', (g, s, t) => {
  const i = g.self, m = real(s[t - 2]), w = g.room.width, h = g.room.height;
  if (truthy(s[t])) {
    if (i.x >= w + m) i.x -= w + 2 * m;
    else if (i.x < -m) i.x += w + 2 * m;
  }
  if (truthy(s[t - 1])) {
    if (i.y >= h + m) i.y -= h + 2 * m;
    else if (i.y < -m) i.y += h + 2 * m;
  }
  return undefined;
});
