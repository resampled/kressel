// effect_create_above/below. An approximation of GM's built-in effects using pooled particles
// drawn as circles; it is not GM's exact particle setup (see the drw_effect note in krpj_opcodes.md).

import type { Renderer } from '../platform/types.ts';
import { GmlError } from '../value.ts';

const MAX = 2048;
// Per particle: x, y, vx, vy, r, dr, life, maxLife, gravity
const F = 9;

export class Effects {
  private readonly p = new Float64Array(MAX * F);
  private readonly colour = new Int32Array(MAX);
  private readonly above = new Uint8Array(MAX);
  private n = 0;
  private readonly rand: () => number;

  constructor(rand: () => number) { this.rand = rand; }

  create(kind: number, x: number, y: number, size: number, colour: number, above: boolean): void {
    const k = size <= 0 ? 0.5 : size >= 2 ? 2 : 1;
    switch (kind) {
      case 0: // explosion: a quick flash plus expanding puffs
        this.add(x, y, 0, 0, 12 * k, 3 * k, 8, 0, colour, above);
        for (let i = 0; i < 10; i++) this.burst(x, y, 1.5 * k, 6 * k, 0.4 * k, 18, 0, colour, above);
        return;
      case 1: // ring
        this.add(x, y, 0, 0, 4 * k, 4 * k, 12, 0, colour, above);
        return;
      case 3: // firework: sparks flying out, falling slightly
        for (let i = 0; i < 40; i++) this.burst(x, y, 4 * k, 2 * k, 0, 30, 0.08, colour, above);
        return;
    }
    throw new GmlError(`effect kind ${kind} is not implemented in krplayer yet`);
  }

  private burst(x: number, y: number, spd: number, r: number, dr: number, life: number, grav: number, c: number, above: boolean) {
    const a = this.rand() * Math.PI * 2, v = spd * (0.3 + 0.7 * this.rand());
    this.add(x, y, Math.cos(a) * v, Math.sin(a) * v, r, dr, life * (0.6 + 0.4 * this.rand()), grav, c, above);
  }

  private add(x: number, y: number, vx: number, vy: number, r: number, dr: number, life: number, grav: number, c: number, above: boolean) {
    if (this.n >= MAX) return;
    const o = this.n * F, p = this.p;
    p[o] = x; p[o + 1] = y; p[o + 2] = vx; p[o + 3] = vy; p[o + 4] = r; p[o + 5] = dr; p[o + 6] = life; p[o + 7] = life; p[o + 8] = grav;
    this.colour[this.n] = c; this.above[this.n] = above ? 1 : 0;
    this.n++;
  }

  step(): void {
    const p = this.p;
    for (let i = 0; i < this.n;) {
      const o = i * F;
      if (--p[o + 6] <= 0) { // swap-remove
        const last = (this.n - 1) * F;
        p.copyWithin(o, last, last + F);
        this.colour[i] = this.colour[this.n - 1]; this.above[i] = this.above[this.n - 1];
        this.n--;
        continue;
      }
      p[o + 3] += p[o + 8];
      p[o] += p[o + 2]; p[o + 1] += p[o + 3]; p[o + 4] += p[o + 5];
      i++;
    }
  }

  draw(r: Renderer, above: boolean): void {
    const p = this.p;
    for (let i = 0; i < this.n; i++) {
      if ((this.above[i] === 1) !== above) continue;
      const o = i * F;
      r.circle(p[o], p[o + 1], Math.max(0.5, p[o + 4]), this.colour[i], p[o + 6] / p[o + 7], false);
    }
  }

  clear(): void { this.n = 0; }
}
