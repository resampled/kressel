// Mask geometry. "rect" masks collide as the axis-aligned box around the transformed mask
// rectangle; "rotated" masks collide as the oriented rectangle itself (SAT); "precise" masks test
// the pixels where the two boxes overlap, sampled at pixel centres and mapped back into each mask.
// Works on caller-provided scratch buffers (newShape): no allocations per test.

import type { Instance } from './instance.ts';

const D2R = Math.PI / 180;

/**
 * Shape scratch: corners x0 y0 .. x3 y3, box l t r b, then (oriented/precise) the inverse transform:
 * 12 x, 13 y, 14 cos, 15 sin, 16 xscale, 17 yscale, 18 ox, 19 oy, 20-23 mask rect l t r b (exclusive r/b),
 * 24 mask stride, 25 mask byte offset. `bits` is the mask bitmap of a precise shape.
 */
export type Shape = Float64Array & { bits?: Uint8Array | null };
export const newShape = (): Shape => new Float64Array(26);

/** Fills out for inst at (x, y). Returns 0 (no mask), 1 (box), 2 (oriented) or 3 (precise). */
export function shape(inst: Instance, x: number, y: number, out: Shape): number {
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
  const kind = spr.bits ? 3 : spr.maskKind === 0 || inst.image_angle % 90 === 0 ? 1 : 2;
  if (kind === 1) return 1;
  out[12] = x; out[13] = y; out[14] = c; out[15] = s; out[16] = xs; out[17] = ys; out[18] = spr.ox; out[19] = spr.oy;
  out[20] = bl; out[21] = bt; out[22] = br + 1; out[23] = bb + 1; out[24] = spr.stride;
  if (kind === 3) {
    const n = spr.nBits, f = ((Math.floor(inst.image_index) % n) + n) % n;
    out[25] = f * spr.stride * spr.height;
    out.bits = spr.bits;
  }
  return kind;
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

/** Is room point (wx, wy) inside an oriented (2) or precise (3) shape? */
function inside(kind: number, s: Shape, wx: number, wy: number): boolean {
  const dx = wx - s[12], dy = wy - s[13];
  const lx = Math.floor((dx * s[14] - dy * s[15]) / s[16] + s[18]), ly = Math.floor((dx * s[15] + dy * s[14]) / s[17] + s[19]);
  if (lx < s[20] || ly < s[21] || lx >= s[22] || ly >= s[23]) return false;
  return kind === 2 || ((s.bits![s[25] + ly * s[24] + (lx >> 3)] >> (7 - (lx & 7))) & 1) === 1;
}

export function overlaps(ka: number, a: Shape, kb: number, b: Shape): boolean {
  if (!ka || !kb || !boxesOverlap(a, b)) return false;
  if (ka === 1 && kb === 1) return true;
  if (ka !== 3 && kb !== 3) {
    asQuad(ka, a); asQuad(kb, b);
    return !separated(a, a, b) && !separated(b, a, b);
  }
  // Precise: every pixel cell touching both boxes, tested at its centre (box shapes cover the whole overlap).
  const r = Math.min(a[10], b[10]), bt = Math.min(a[11], b[11]);
  for (let j = Math.floor(Math.max(a[9], b[9])); j < bt; j++) {
    for (let i = Math.floor(Math.max(a[8], b[8])); i < r; i++) {
      if ((ka === 1 || inside(ka, a, i + 0.5, j + 0.5)) && (kb === 1 || inside(kb, b, i + 0.5, j + 0.5))) return true;
    }
  }
  return false;
}
