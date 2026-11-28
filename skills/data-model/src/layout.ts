// Layered (Sugiyama-style) layout of a DAG whose edges all point from a lower
// node index to a higher one, drawn top to bottom.
//   1. Layer = longest path from a root; roots then sink to just above their
//      highest dependent.
//   2. Edges spanning several layers get a virtual node in each layer they cross.
//   3. Order within layers: barycenter down/up sweeps, keeping the order with the
//      fewest crossings, then adjacent swaps while they remove crossings.
//   4. Each layer is packed left to right and centred; boxes are top-aligned.
//   5. Edges leave from ports spread along a box's bottom, run straight down to
//      the bottom of their layer, cross each gap as a curve with vertical ends,
//      and pass through virtual nodes as vertical runs, so they never touch a box.
// Everything is deterministic: ties break by node index.

export interface Size {
  w: number;
  h: number;
}

export interface Box {
  /** Centre x and top y. */
  cx: number;
  top: number;
  w: number;
  h: number;
  layer: number;
}

/** A gap crossing: a curve from `from` to `to` leaving and arriving vertically. */
export type Seg = { kind: "line"; to: Pt } | { kind: "curve"; to: Pt };
export interface Pt {
  x: number;
  y: number;
}

export interface Route {
  from: number;
  to: number;
  start: Pt;
  segs: Seg[];
  /** Arrow tip, on the target box's top edge (the end of the last segment). */
  tip: Pt;
}

export interface Layout {
  boxes: Box[];
  routes: Route[];
  /** Layer index → item order, real nodes as their index and virtual nodes as -1 (for tests). */
  order: number[][];
  crossings: number;
  width: number;
  /** y of the last layer's bottom. */
  bottom: number;
  /** Bounding box of everything drawn. */
  minX: number;
  maxX: number;
}

export interface LayoutOpts {
  /** Horizontal gap between two boxes. */
  gapX: number;
  /** Gap next to a virtual node. */
  gapVirtual: number;
  /** Vertical gap between layers. */
  gapY: number;
  /** Straight run into the arrow tip. */
  stub: number;
  /** Max distance between neighbouring ports on one box side. */
  portGap: number;
  /** Ports stay this far from a box's corners. */
  portInset: number;
  /** y of the first layer's top. */
  top: number;
}

export const DEFAULTS: LayoutOpts = {
  gapX: 28,
  gapVirtual: 18,
  gapY: 56,
  stub: 12,
  portGap: 18,
  portInset: 24,
  top: 0,
};

interface Item {
  layer: number;
  /** Real node index, or -1 for a virtual node. */
  node: number;
  w: number;
  /** Tie-break key: real nodes by index, virtual nodes after, by edge. */
  key: number[];
}

/**
 * Longest path from a root; edges must go from lower to higher index. A root
 * that something depends on then sinks to just above its highest dependent,
 * so a step needed late in the plan is drawn where it is needed.
 */
export function layers(n: number, edges: readonly (readonly [number, number])[]): number[] {
  const layer = new Array<number>(n).fill(0);
  const preds: number[][] = Array.from({ length: n }, () => []);
  const succs: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    if (!(a < b)) throw new Error(`edge ${a}→${b} does not point forward`);
    preds[b]!.push(a);
    succs[a]!.push(b);
  }
  for (let v = 0; v < n; v++) for (const u of preds[v]!) layer[v] = Math.max(layer[v]!, layer[u]! + 1);
  for (let v = 0; v < n; v++) {
    if (preds[v]!.length > 0 || succs[v]!.length === 0) continue;
    layer[v] = Math.min(...succs[v]!.map((w) => layer[w]!)) - 1;
  }
  return layer;
}

/**
 * Transitive reduction of a forward DAG: drop an edge a→c when another path
 * a→…→c exists. Kept edges stay in input order.
 */
export function reduce(n: number, edges: readonly (readonly [number, number])[]): [number, number][] {
  const succs: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) succs[a]!.push(b);
  // reach[v]: nodes reachable from v by a path of one or more edges.
  const reach: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let v = n - 1; v >= 0; v--) {
    for (const w of succs[v]!) {
      reach[v]!.add(w);
      for (const x of reach[w]!) reach[v]!.add(x);
    }
  }
  return edges
    .filter(([a, c]) => !succs[a]!.some((b) => b !== c && reach[b]!.has(c)))
    .map(([a, c]) => [a, c] as [number, number]);
}

function cmpKey(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

class Graph {
  items: Item[] = [];
  /** Per edge, the chain of items from source to target. */
  chains: number[][] = [];
  up: number[][] = []; // item → items in the layer above
  down: number[][] = []; // item → items in the layer below
  order: number[][] = [];
  pos: number[] = [];

  constructor(sizes: readonly Size[], edges: readonly (readonly [number, number])[], layer: readonly number[]) {
    sizes.forEach((s, i) => this.items.push({ layer: layer[i]!, node: i, w: s.w, key: [i] }));
    edges.forEach(([a, b], e) => {
      const chain = [a];
      for (let l = layer[a]! + 1; l < layer[b]!; l++) {
        chain.push(this.items.length);
        this.items.push({ layer: l, node: -1, w: 0, key: [sizes.length, a, b, e] });
      }
      chain.push(b);
      this.chains.push(chain);
    });
    this.up = this.items.map(() => []);
    this.down = this.items.map(() => []);
    for (const c of this.chains) {
      for (let k = 0; k + 1 < c.length; k++) {
        this.down[c[k]!]!.push(c[k + 1]!);
        this.up[c[k + 1]!]!.push(c[k]!);
      }
    }
    const nl = Math.max(0, ...layer) + 1;
    this.order = Array.from({ length: nl }, () => []);
    const byKey = this.items.map((_, i) => i).sort((p, q) => cmpKey(this.items[p]!.key, this.items[q]!.key));
    for (const i of byKey) this.order[this.items[i]!.layer]!.push(i);
    this.pos = new Array<number>(this.items.length).fill(0);
    this.reindex();
  }

  reindex(): void {
    for (const row of this.order) row.forEach((it, p) => (this.pos[it] = p));
  }

  /** Crossings between layer l and l+1. */
  crossingsAt(l: number): number {
    const segs: [number, number][] = [];
    for (const a of this.order[l]!) for (const b of this.down[a]!) segs.push([this.pos[a]!, this.pos[b]!]);
    let c = 0;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const [a1, b1] = segs[i]!;
        const [a2, b2] = segs[j]!;
        if ((a1 - a2) * (b1 - b2) < 0) c++;
      }
    }
    return c;
  }

  crossings(): number {
    let c = 0;
    for (let l = 0; l + 1 < this.order.length; l++) c += this.crossingsAt(l);
    return c;
  }

  /** Reorder layer l by the mean position of each item's neighbours (above or below). */
  sweepLayer(l: number, dir: "down" | "up"): void {
    const nb = dir === "down" ? this.up : this.down;
    const bary = new Map<number, number>();
    for (const it of this.order[l]!) {
      const ns = nb[it]!;
      bary.set(it, ns.length === 0 ? this.pos[it]! : ns.reduce((s, x) => s + this.pos[x]!, 0) / ns.length);
    }
    this.order[l]!.sort((p, q) => bary.get(p)! - bary.get(q)! || cmpKey(this.items[p]!.key, this.items[q]!.key));
    this.order[l]!.forEach((it, p) => (this.pos[it] = p));
  }

  /** Swap neighbours within a layer while that strictly lowers the crossings around it. */
  transpose(): void {
    const local = (l: number): number => (l > 0 ? this.crossingsAt(l - 1) : 0) + (l + 1 < this.order.length ? this.crossingsAt(l) : 0);
    for (let round = 0, improved = true; improved && round < 20; round++) {
      improved = false;
      for (let l = 0; l < this.order.length; l++) {
        const row = this.order[l]!;
        for (let p = 0; p + 1 < row.length; p++) {
          const before = local(l);
          [row[p], row[p + 1]] = [row[p + 1]!, row[p]!];
          this.pos[row[p]!] = p;
          this.pos[row[p + 1]!] = p + 1;
          if (local(l) < before) {
            improved = true;
          } else {
            [row[p], row[p + 1]] = [row[p + 1]!, row[p]!];
            this.pos[row[p]!] = p;
            this.pos[row[p + 1]!] = p + 1;
          }
        }
      }
    }
  }

  minimiseCrossings(): void {
    let best = this.order.map((r) => [...r]);
    let bestC = this.crossings();
    let stale = 0;
    for (let it = 0; it < 24 && bestC > 0 && stale < 4; it++) {
      for (let l = 1; l < this.order.length; l++) this.sweepLayer(l, "down");
      for (let l = this.order.length - 2; l >= 0; l--) this.sweepLayer(l, "up");
      const c = this.crossings();
      if (c < bestC) {
        bestC = c;
        best = this.order.map((r) => [...r]);
        stale = 0;
      } else stale++;
    }
    this.order = best;
    this.reindex();
    this.transpose();
  }
}

/** Spread k ports across a box side, ordered as given. */
function ports(cx: number, w: number, k: number, o: LayoutOpts): number[] {
  if (k === 1) return [cx];
  const span = Math.min((k - 1) * o.portGap, Math.max(0, w - 2 * o.portInset));
  return Array.from({ length: k }, (_, i) => cx - span / 2 + (span * i) / (k - 1));
}

/** Lay out and route `edges`; their layers are the layers of the full graph they reduce. */
export function layout(sizes: readonly Size[], edges: readonly (readonly [number, number])[], opts: Partial<LayoutOpts> = {}): Layout {
  const o: LayoutOpts = { ...DEFAULTS, ...opts };
  const layer = layers(sizes.length, edges);
  const g = new Graph(sizes, edges, layer);
  g.minimiseCrossings();

  // Vertical: top-aligned boxes, layer height = tallest box.
  const nl = g.order.length;
  const layerH = g.order.map((row) => Math.max(0, ...row.filter((it) => g.items[it]!.node >= 0).map((it) => sizes[g.items[it]!.node]!.h)));
  const layerTop: number[] = [];
  let y = o.top;
  for (let l = 0; l < nl; l++) {
    layerTop.push(y);
    y += layerH[l]! + o.gapY;
  }
  const bottom = y - o.gapY;

  // Horizontal: pack each layer and centre it on x = 0.
  const cx = new Array<number>(g.items.length).fill(0);
  for (const row of g.order) {
    const gaps = row.slice(1).map((it, k) => (g.items[it]!.node < 0 || g.items[row[k]!]!.node < 0 ? o.gapVirtual : o.gapX));
    const total = row.reduce((s, it) => s + g.items[it]!.w, 0) + gaps.reduce((s, x) => s + x, 0);
    let x = -total / 2;
    row.forEach((it, k) => {
      if (k > 0) x += gaps[k - 1]!;
      cx[it] = x + g.items[it]!.w / 2;
      x += g.items[it]!.w;
    });
  }

  const boxes: Box[] = sizes.map((s, i) => ({ cx: cx[i]!, top: layerTop[layer[i]!]!, w: s.w, h: s.h, layer: layer[i]! }));

  // Ports: out-edges sorted by where they head next, in-edges by where they come from.
  const outPort = new Map<number, number>(); // edge → x
  const inPort = new Map<number, number>();
  const assign = (side: Map<number, number>, byNode: Map<number, number[]>, near: (e: number) => number, other: (e: number) => number): void => {
    for (const [node, es] of byNode) {
      es.sort((a, b) => near(a) - near(b) || other(a) - other(b));
      const xs = ports(cx[node]!, sizes[node]!.w, es.length, o);
      es.forEach((e, k) => side.set(e, xs[k]!));
    }
  };
  const outs = new Map<number, number[]>();
  const ins = new Map<number, number[]>();
  g.chains.forEach((c, e) => {
    outs.set(c[0]!, [...(outs.get(c[0]!) ?? []), e]);
    ins.set(c[c.length - 1]!, [...(ins.get(c[c.length - 1]!) ?? []), e]);
  });
  const ch = g.chains;
  assign(outPort, outs, (e) => cx[ch[e]![1]!]!, (e) => ch[e]![ch[e]!.length - 1]!);
  assign(inPort, ins, (e) => cx[ch[e]![ch[e]!.length - 2]!]!, (e) => ch[e]![0]!);

  const routes: Route[] = g.chains.map((c, e) => {
    const src = c[0]!;
    const dst = c[c.length - 1]!;
    const bottomOf = (it: number): number => layerTop[g.items[it]!.layer]! + layerH[g.items[it]!.layer]!;
    const sx = outPort.get(e)!;
    const start = { x: sx, y: boxes[src]!.top + sizes[src]!.h };
    const segs: Seg[] = [];
    let cur = start;
    if (bottomOf(src) > cur.y) segs.push({ kind: "line", to: (cur = { x: sx, y: bottomOf(src) }) });
    for (let k = 1; k < c.length; k++) {
      const it = c[k]!;
      const top = layerTop[g.items[it]!.layer]!;
      if (k < c.length - 1) {
        segs.push({ kind: "curve", to: (cur = { x: cx[it]!, y: top }) });
        segs.push({ kind: "line", to: (cur = { x: cx[it]!, y: bottomOf(it) }) });
      } else {
        const tx = inPort.get(e)!;
        segs.push({ kind: "curve", to: (cur = { x: tx, y: top - o.stub }) });
        segs.push({ kind: "line", to: (cur = { x: tx, y: top }) });
      }
    }
    return { from: src, to: dst, start, segs, tip: cur };
  });

  let minX = Infinity;
  let maxX = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.cx - b.w / 2);
    maxX = Math.max(maxX, b.cx + b.w / 2);
  }
  for (let it = 0; it < g.items.length; it++) {
    minX = Math.min(minX, cx[it]!);
    maxX = Math.max(maxX, cx[it]!);
  }
  if (!Number.isFinite(minX)) [minX, maxX] = [0, 0];

  return {
    boxes,
    routes,
    order: g.order.map((row) => row.map((it) => g.items[it]!.node)),
    crossings: g.crossings(),
    width: maxX - minX,
    bottom,
    minX,
    maxX,
  };
}
