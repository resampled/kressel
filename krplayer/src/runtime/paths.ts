// Paths: the project's paths plus ones made at runtime (path_add), their geometry, and path following.
// Positions are 0..1 along the path's length. See gm_gotchas.md for what's observed vs assumed.

import type { Path } from '../krpj.ts';
import { GmlError } from '../value.ts';
import type { Instance } from './instance.ts';

export class PathDef {
  /** Control points: x, y, speed (percent), flat. */
  pts: number[];
  smooth: boolean; closed: boolean; precision: number;
  /** The polyline actually followed (x, y, speed, cumulative length per vertex), rebuilt when the path changes. */
  private line: number[] = [];
  private dirty = true;
  len = 0;

  constructor(p?: Path) {
    this.pts = p ? p.points.flat() : [];
    this.smooth = !!p?.smooth; this.closed = !!p?.closed; this.precision = p?.precision ?? 4;
  }
  changed(): void { this.dirty = true; }
  get count(): number { return this.pts.length / 3; }

  private build(): void {
    this.dirty = false;
    const P = this.pts, n = this.count, out = this.line;
    out.length = 0; this.len = 0;
    const add = (x: number, y: number, s: number) => {
      const k = out.length;
      const d = k ? Math.hypot(x - out[k - 4], y - out[k - 3]) : 0;
      this.len += d;
      out.push(x, y, s, this.len);
    };
    if (n === 0) return;
    if (!this.smooth || n < 3) {
      for (let i = 0; i < n; i++) add(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      if (this.closed && n > 1) add(P[0], P[1], P[2]);
      return;
    }
    // Smooth: quadratic pieces between segment midpoints, subdivided `precision` times (assumed GM's scheme).
    const at = (i: number, c: number) => P[(((i % n) + n) % n) * 3 + c];
    const mid = (i: number, c: number) => (at(i, c) + at(i + 1, c)) / 2;
    const piece = (depth: number, x1: number, y1: number, s1: number, x2: number, y2: number, s2: number, x3: number, y3: number, s3: number): void => {
      if (depth <= 0) return;
      const mx = (x1 + 2 * x2 + x3) / 4, my = (y1 + 2 * y2 + y3) / 4, ms = (s1 + 2 * s2 + s3) / 4;
      piece(depth - 1, x1, y1, s1, (x1 + x2) / 2, (y1 + y2) / 2, (s1 + s2) / 2, mx, my, ms);
      add(mx, my, ms);
      piece(depth - 1, mx, my, ms, (x2 + x3) / 2, (y2 + y3) / 2, (s2 + s3) / 2, x3, y3, s3);
    };
    const pieces = this.closed ? n : n - 2;
    if (this.closed) add(mid(0, 0), mid(0, 1), mid(0, 2)); else add(P[0], P[1], P[2]);
    for (let i = 0; i < pieces; i++) {
      const a = this.closed || i > 0, b = this.closed || i < pieces - 1;
      const x1 = a ? mid(i, 0) : at(i, 0), y1 = a ? mid(i, 1) : at(i, 1), s1 = a ? mid(i, 2) : at(i, 2);
      const x3 = b ? mid(i + 1, 0) : at(i + 2, 0), y3 = b ? mid(i + 1, 1) : at(i + 2, 1), s3 = b ? mid(i + 1, 2) : at(i + 2, 2);
      piece(this.precision, x1, y1, s1, at(i + 1, 0), at(i + 1, 1), at(i + 1, 2), x3, y3, s3);
      add(x3, y3, s3);
    }
  }

  length(): number { if (this.dirty) this.build(); return this.len; }

  /** Component c (0 x, 1 y, 2 speed) at position t (0..1). */
  at(t: number, c: number): number {
    if (this.dirty) this.build();
    const L = this.line, n = L.length / 4;
    if (n === 0) return 0;
    if (n === 1 || this.len <= 0) return L[c];
    const d = Math.max(0, Math.min(1, t)) * this.len;
    let i = 1;
    while (i < n - 1 && L[i * 4 + 3] < d) i++;
    const d0 = L[(i - 1) * 4 + 3], seg = L[i * 4 + 3] - d0, f = seg > 0 ? (d - d0) / seg : 0;
    return L[(i - 1) * 4 + c] + (L[i * 4 + c] - L[(i - 1) * 4 + c]) * f;
  }

  /** The followed polyline, for draw_path: x, y pairs. */
  polyline(): number[] {
    if (this.dirty) this.build();
    const out: number[] = [];
    for (let k = 0; k < this.line.length; k += 4) out.push(this.line[k], this.line[k + 1]);
    return out;
  }
}

export class Paths {
  readonly list: (PathDef | null)[];
  constructor(defs: Path[]) { this.list = defs.map((p) => new PathDef(p)); }

  get(id: number, fn: string): PathDef {
    const p = this.list[Math.trunc(id)];
    if (!p) throw new GmlError(`${fn}: path ${id} does not exist`);
    return p;
  }
  exists(id: number): boolean { return !!this.list[Math.trunc(id)]; }
  add(): number { this.list.push(new PathDef()); return this.list.length - 1; }
  delete(id: number): void { if (this.exists(id)) this.list[Math.trunc(id)] = null; }

  /** path_start: absolute follows the path's own coordinates; relative puts its first point at the instance. */
  start(inst: Instance, id: number, speed: number, endaction: number, absolute: boolean): void {
    const p = this.get(id, 'path_start');
    inst.path = Math.trunc(id); inst.path_speed = speed; inst.path_endaction = endaction;
    inst.path_position = 0; inst.path_positionprevious = 0;
    inst.pathX = absolute ? p.at(0, 0) : inst.x; inst.pathY = absolute ? p.at(0, 1) : inst.y;
    if (absolute) { inst.x = inst.pathX; inst.y = inst.pathY; }
  }

  /** Moves an instance along its path for one step. Returns true when it reached an end (path end event). */
  step(inst: Instance): boolean {
    const p = this.list[inst.path];
    if (!p) { inst.path = -1; return false; }
    const len = p.length() * inst.path_scale;
    if (len <= 0) return false;
    inst.path_positionprevious = inst.path_position;
    let pos = inst.path_position + (inst.path_speed * p.at(inst.path_position, 2) / 100) / len;
    let ended = false;
    if (pos >= 1 || pos <= 0) {
      ended = true;
      const fwd = pos >= 1;
      switch (inst.path_endaction) {
        case 1: pos = fwd ? pos - 1 : pos + 1; break; // restart
        case 2: { // continue: the next lap starts where this one ended
          this.offset(inst, p, fwd ? 1 : 0); inst.pathX += this.ox; inst.pathY += this.oy;
          this.offset(inst, p, fwd ? 0 : 1); inst.pathX -= this.ox; inst.pathY -= this.oy;
          pos = fwd ? pos - 1 : pos + 1;
          break;
        }
        case 3: pos = fwd ? 2 - pos : -pos; inst.path_speed = -inst.path_speed; break; // reverse
        default: pos = fwd ? 1 : 0;
      }
    }
    inst.path_position = pos;
    this.offset(inst, p, pos);
    inst.x = inst.pathX + this.ox; inst.y = inst.pathY + this.oy;
    if (ended && inst.path_endaction === 0) inst.path = -1;
    return ended;
  }

  private ox = 0; private oy = 0;
  /** Sets ox/oy to the point at pos relative to the path's start, scaled and rotated by the instance's path settings. */
  private offset(inst: Instance, p: PathDef, pos: number): void {
    const x = (p.at(pos, 0) - p.at(0, 0)) * inst.path_scale, y = (p.at(pos, 1) - p.at(0, 1)) * inst.path_scale;
    const a = (inst.path_orientation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    this.ox = x * c + y * s; this.oy = -x * s + y * c;
  }
}
