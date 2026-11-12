// mp_grid_*: cell grids for path finding. A cell is free (0) or forbidden (1).
// mp_grid_path is A* over free cells (4 or 8 directions; a diagonal step needs both orthogonal neighbours free,
// as in the HTML5 runner), giving start -> cell centres -> goal.

export class MpGrid {
  readonly cells: Uint8Array;
  // A* scratch, reused between searches
  private readonly cost: Float64Array;
  private readonly from: Int32Array;
  private readonly heap: Int32Array;
  private readonly hkey: Float64Array;
  readonly left: number; readonly top: number; readonly hc: number; readonly vc: number; readonly cw: number; readonly ch: number;
  constructor(left: number, top: number, hc: number, vc: number, cw: number, ch: number) {
    this.left = left; this.top = top; this.hc = hc; this.vc = vc; this.cw = cw; this.ch = ch;
    const n = hc * vc;
    this.cells = new Uint8Array(n);
    this.cost = new Float64Array(n); this.from = new Int32Array(n);
    this.heap = new Int32Array(n * 8 + 8); this.hkey = new Float64Array(n * 8 + 8);
  }

  /** Cell index containing (x, y), or -1 outside. */
  cellAt(x: number, y: number): number {
    const h = Math.floor((x - this.left) / this.cw), v = Math.floor((y - this.top) / this.ch);
    return h < 0 || v < 0 || h >= this.hc || v >= this.vc ? -1 : v * this.hc + h;
  }
  set(h: number, v: number, on: number): void { if (h >= 0 && v >= 0 && h < this.hc && v < this.vc) this.cells[v * this.hc + h] = on; }
  /** Marks every cell overlapping the rectangle (room coordinates, inclusive). */
  rect(x1: number, y1: number, x2: number, y2: number, on: number): void {
    const h1 = Math.floor((Math.min(x1, x2) - this.left) / this.cw), h2 = Math.floor((Math.max(x1, x2) - this.left) / this.cw);
    const v1 = Math.floor((Math.min(y1, y2) - this.top) / this.ch), v2 = Math.floor((Math.max(y1, y2) - this.top) / this.ch);
    for (let v = Math.max(0, v1); v <= Math.min(this.vc - 1, v2); v++) for (let h = Math.max(0, h1); h <= Math.min(this.hc - 1, h2); h++) this.cells[v * this.hc + h] = on;
  }

  /** Writes the found path as flat x, y pairs into out; false (out untouched) when there is none. */
  path(xs: number, ys: number, xg: number, yg: number, diag: boolean, out: number[]): boolean {
    const a = this.cellAt(xs, ys), z = this.cellAt(xg, yg), C = this.cells, W = this.hc;
    if (a < 0 || z < 0 || C[a] || C[z]) return false;
    const cost = this.cost, from = this.from, heap = this.heap, key = this.hkey;
    cost.fill(Infinity); from.fill(-1);
    const zh = z % W, zv = (z / W) | 0;
    const est = (c: number) => { const dh = Math.abs(c % W - zh), dv = Math.abs(((c / W) | 0) - zv); return diag ? Math.max(dh, dv) + (Math.SQRT2 - 1) * Math.min(dh, dv) : dh + dv; };
    let hn = 0;
    const push = (c: number, k: number) => {
      if (hn >= heap.length) return;
      let i = hn++;
      while (i > 0) { const p = (i - 1) >> 1; if (key[p] <= k) break; heap[i] = heap[p]; key[i] = key[p]; i = p; }
      heap[i] = c; key[i] = k;
    };
    const pop = () => {
      const top = heap[0], lc = heap[--hn], lk = key[hn];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= hn) break;
        if (c + 1 < hn && key[c + 1] < key[c]) c++;
        if (key[c] >= lk) break;
        heap[i] = heap[c]; key[i] = key[c]; i = c;
      }
      heap[i] = lc; key[i] = lk;
      return top;
    };
    cost[a] = 0; push(a, est(a));
    while (hn) {
      const c = pop();
      if (c === z) break;
      const ch = c % W, cv = (c / W) | 0;
      for (let dv = -1; dv <= 1; dv++) for (let dh = -1; dh <= 1; dh++) {
        if ((!dh && !dv) || (dh && dv && !diag)) continue;
        const h = ch + dh, v = cv + dv;
        if (h < 0 || v < 0 || h >= W || v >= this.vc) continue;
        const nb = v * W + h;
        if (C[nb] || (dh && dv && (C[cv * W + h] || C[v * W + ch]))) continue;
        const nc = cost[c] + (dh && dv ? Math.SQRT2 : 1);
        if (nc < cost[nb]) { cost[nb] = nc; from[nb] = c; push(nb, nc + est(nb)); }
      }
    }
    if (a !== z && from[z] < 0) return false;
    out.length = 0;
    out.push(xg, yg);
    for (let c = from[z]; c >= 0 && c !== a; c = from[c]) out.push(this.left + (c % W + 0.5) * this.cw, this.top + (((c / W) | 0) + 0.5) * this.ch);
    out.push(xs, ys);
    // built goal-first: reverse the pairs
    for (let i = 0, j = out.length - 2; i < j; i += 2, j -= 2) {
      const x = out[i], y = out[i + 1];
      out[i] = out[j]; out[i + 1] = out[j + 1]; out[j] = x; out[j + 1] = y;
    }
    return true;
  }
}
