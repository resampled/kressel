// Drawing (drw_*).

import { define } from './registry.ts';
import { GmlError, real, str } from '../value.ts';
import type { Game } from '../runtime/game.ts';
import type { FontDef } from '../runtime/assets.ts';

define('drw_self', (g) => { g.drawSelf(g.self); return undefined; });
define('drw_set_font', (g, s, t) => {
  const f = real(s[t]);
  if (f !== -1 && !g.a.fonts[f]) throw new GmlError(`font ${f} does not exist`);
  g.font = f; return undefined;
});
define('drw_set_colour', (g, s, t) => { g.colour = real(s[t]); return undefined; });
define('drw_set_alpha', (g, s, t) => { g.alpha = real(s[t]); return undefined; });
define('drw_set_align', (g, s, t) => {
  if (s[t] === 'h') g.halign = real(s[t - 1]); else g.valign = real(s[t - 1]);
  return undefined;
});
define('drw_text', (g, s, t) => { text(g, real(s[t]), real(s[t - 1]), str(s[t - 2])); return undefined; });

define('drw_effect', (g, s, t) => {
  g.fx.create(real(s[t - 1]), real(s[t - 2]), real(s[t - 3]), real(s[t - 4]), real(s[t - 5]), s[t] === 'above');
  return undefined;
});

function lineWidth(f: FontDef, txt: string, from: number): number {
  let w = 0;
  for (let i = from; i < txt.length && txt.charCodeAt(i) !== 10; i++) w += f.glyphs.get(txt.charCodeAt(i))?.[4] ?? 0;
  return w;
}

/** draw_text: glyph by glyph from the font atlas, honouring align; "\n" breaks lines. */
function text(g: Game, x: number, y: number, txt: string): void {
  const r = g.p.renderer, f = g.a.fonts[g.font];
  if (!f) { r.systemText(txt, x, y, g.colour, g.alpha); return; }
  let lines = 1;
  for (let i = 0; i < txt.length; i++) if (txt.charCodeAt(i) === 10) lines++;
  let cy = y - (g.valign === 1 ? (lines * f.lineHeight) / 2 : g.valign === 2 ? lines * f.lineHeight : 0);
  let start = 0;
  while (start <= txt.length) {
    const w = g.halign ? lineWidth(f, txt, start) : 0;
    let cx = x - (g.halign === 1 ? Math.floor(w / 2) : g.halign === 2 ? w : 0);
    let i = start;
    for (; i < txt.length; i++) {
      const c = txt.charCodeAt(i);
      if (c === 10) break;
      const gl = f.glyphs.get(c);
      if (!gl) continue;
      r.drawImage(f.tex, gl[0], gl[1], gl[2], gl[3], cx + gl[5], cy, 0, 0, 1, 1, 0, g.colour, g.alpha);
      cx += gl[4];
    }
    cy += f.lineHeight;
    start = i + 1;
  }
}
