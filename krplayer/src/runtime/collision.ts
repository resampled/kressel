// Mask geometry. "rect" masks collide as the axis-aligned box around the transformed mask
// rectangle; "rotated" masks collide as the oriented rectangle itself (SAT). Precise (per-pixel)
// masks are not implemented yet and use the rotated rectangle.
// Works on caller-provided scratch buffers: no allocations per test.

import type { Instance } from './instance.ts';

const D2R = Math.PI / 180;

/** Shape scratch: corners x0 y0 .. x3 y3, then box l t r b. Returns 0 (no mask), 1 (box) or 2 (oriented). */
export function shape(inst: Instance, x: number, y: number, out: Float64Array): number {
  const spr = inst.mask ?? inst.sprite;
  if (!spr) return 0;
  const [bl, bt, br, bb] = spr.bbox;
  // Mask rectangle relative to the origin; right/bottom are inclusive pixels, so +1.
  const l = bl - spr.ox, t = bt - spr.oy, r = br + 1 - spr.ox, b = bb + 1 - spr.oy;
  const xs = inst.image_xscale, ys = inst.image_yscale, a = inst.image_angle * D2R;
  const c = Math.cos(a), s = Math.sin(a);
  // Screen y points down, so a counter-clockwise angle is (x c + y s, -x s + y c).
  corner(out, 0, l * xs, t * ys, c, s, x, y);
  corner(out, 2, r * xs, t * ys, c, s, x, y);
  corner(out, 4, r * xs, b * ys, c, s, x, y);
  corner(out, 6, l * xs, b * ys, c, s, x, y);
  out[8] = Math.min(out[0], out[2], out[4], out[6]); out[9] = Math.min(out[1], out[3], out[5], out[7]);
  out[10] = Math.max(out[0], out[2], out[4], out[6]); out[11] = Math.max(out[1], out[3], out[5], out[7]);
  return spr.maskKind === 0 || inst.image_angle % 90 === 0 ? 1 : 2;
}

function corner(o: Float64Array, i: number, px: number, py: number, c: number, s: number, x: number, y: number) {
  o[i] = x + px * c + py * s;
  o[i + 1] = y - px * s + py * c;
}

const boxesOverlap = (a: Float64Array, b: Float64Array) => a[8] < b[10] && b[8] < a[10] && a[9] < b[11] && b[9] < a[11];

/** Separating-axis test on the edges of quad `axes` (2 unique axes). */
function separated(axes: Float64Array, a: Float64Array, b: Float64Array): boolean {
  for (let e = 0; e < 4; e += 2) {
    const ax = axes[e + 2] - axes[e], ay = axes[e + 3] - axes[e + 1];
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (let k = 0; k < 8; k += 2) {
      const pa = a[k] * ax + a[k + 1] * ay, pb = b[k] * ax + b[k + 1] * ay;
      if (pa < amin) amin = pa; if (pa > amax) amax = pa;
      if (pb < bmin) bmin = pb; if (pb > bmax) bmax = pb;
    }
    if (amax <= bmin || bmax <= amin) return true;
  }
  return false;
}

/** Box shapes are tested as their box; oriented ones as the quad. */
function asQuad(kind: number, s: Float64Array): void {
  if (kind !== 1) return;
  s[0] = s[8]; s[1] = s[9]; s[2] = s[10]; s[3] = s[9]; s[4] = s[10]; s[5] = s[11]; s[6] = s[8]; s[7] = s[11];
}

export function overlaps(ka: number, a: Float64Array, kb: number, b: Float64Array): boolean {
  if (!ka || !kb || !boxesOverlap(a, b)) return false;
  if (ka === 1 && kb === 1) return true;
  asQuad(ka, a); asQuad(kb, b);
  return !separated(a, a, b) && !separated(b, a, b);
}
