// Instances (ins_*).

import { define } from './registry.ts';
import { real, truthy } from '../value.ts';

define('ins_create_layer', (g, s, t) => g.spawn(g.object(s[t - 3]), real(s[t]), real(s[t - 1]), g.layerDepth(s[t - 2])).id);
define('ins_create_depth', (g, s, t) => g.spawn(g.object(s[t - 3]), real(s[t]), real(s[t - 1]), real(s[t - 2])).id);

define('ins_destroy', (g, s, t, argc) => {
  const run = argc < 2 || truthy(s[t - 1]);
  if (argc === 0) { g.destroy(g.self, run); return undefined; }
  const target = real(s[t]);
  for (const inst of g.instances) {
    if (inst.alive && (target >= 100000 ? inst.id === target : target === -3 || inst.obj.isA.has(target))) g.destroy(inst, run);
  }
  return undefined;
});

define('ins_exists', (g, s, t) => g.first(real(s[t]))?.alive === true);
define('ins_number', (g, s, t) => g.count(real(s[t])));
