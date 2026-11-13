// GM's matrix builders: 16-element row-vector matrices, left-handed (D3DX conventions, translation in 12..14).

export function lookAt(fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, ux: number, uy: number, uz: number): number[] {
  let zx = tx - fx, zy = ty - fy, zz = tz - fz;
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [
    xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * fx + xy * fy + xz * fz), -(yx * fx + yy * fy + yz * fz), -(zx * fx + zy * fy + zz * fz), 1,
  ];
}

export const ortho = (w: number, h: number, zn: number, zf: number): number[] =>
  [2 / w, 0, 0, 0, 0, 2 / h, 0, 0, 0, 0, 1 / (zf - zn), 0, 0, 0, zn / (zn - zf), 1];

export const perspective = (w: number, h: number, zn: number, zf: number): number[] =>
  [(2 * zn) / w, 0, 0, 0, 0, (2 * zn) / h, 0, 0, 0, 0, zf / (zf - zn), 1, 0, 0, (zn * zf) / (zn - zf), 0];

/** fov is the vertical field of view in degrees; aspect is width / height. */
export function perspectiveFov(fov: number, aspect: number, zn: number, zf: number): number[] {
  const ys = 1 / Math.tan((fov * Math.PI) / 360), xs = ys / aspect;
  return [xs, 0, 0, 0, 0, ys, 0, 0, 0, 0, zf / (zf - zn), 1, 0, 0, (zn * zf) / (zn - zf), 0];
}

/** GM's 2D camera view: looking along +z from z -16000 at the view's centre, up rotated by the view angle. */
export function viewMat2d(x: number, y: number, w: number, h: number, angle: number): number[] {
  const cx = x + w / 2, cy = y + h / 2, a = (-angle * Math.PI) / 180;
  return lookAt(cx, cy, -16000, cx, cy, 0, Math.sin(a), Math.cos(a), 0);
}
