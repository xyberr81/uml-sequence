// Draw a data model on the plan graph's layered layout, turned to run left to
// right. Each table is a grid (type, name, key, note) in its own light colour from
// a fixed palette; new tables and columns get a black "new" badge, deleted ones are
// dashed black and white. A relation meets each table at the side facing the other,
// at the row it names, or the header when it names none.
import { layout, type Layout, type Pt, type Route, type Size } from "./layout.ts";
import { dashAttr, FAMILY, FONT, MIDDLE, PLAIN, bold, seg, textEl } from "./svg.ts";
import { displayFloat, esc, f, textW } from "./text.ts";
import type { End, Entity, Model, Row } from "./parse.ts";

/** Border and light fill per table, by declaration order, after reference-schema.png. */
const PALETTE: readonly (readonly [string, string])[] = [
  ["#e86a6a", "#fdf1f1"], // red
  ["#a48cf0", "#f5f2fe"], // purple
  ["#34c7aa", "#effaf7"], // teal
  ["#2ecbe0", "#ebfafd"], // cyan
  ["#efc523", "#fefae6"], // yellow
  ["#4cd17c", "#eefbf2"], // green
  ["#7d8ef0", "#eef0fd"], // blue
  ["#a5d93a", "#f5fbe8"], // lime
  ["#ef944b", "#fef4eb"], // orange
  ["#de7ae6", "#fcf0fd"], // pink
];
const PAD = 10.0;
const HEAD = 30.0;
const ROW = 26.0;
const SEP = 6.0;
const MARGIN = 20.0;
const LOOP = 30.0;
/** Spacing between neighbouring vertical channels in a gap, when the gap has room. */
const CHANNEL = 16.0;
/** Straight run at each end of a relation, long enough for its marks. */
const RUN = 26.0;
const BADGE_SIZE = 10.0;
const BADGE_W = textW("new", BADGE_SIZE, true) + 8.0;
const STROKE = 'stroke="#000" stroke-width="1.2"';

function badge(x: number, midY: number): string {
  const h = 13.0;
  return (
    `<g class="new-icon"><rect x="${f(x)}" y="${f(midY - h / 2)}" width="${f(BADGE_W)}" height="${f(h)}" rx="3" fill="#000"/>` +
    `<text x="${f(x + BADGE_W / 2)}" y="${f(midY + 3.5)}" text-anchor="middle" font-size="${f(BADGE_SIZE)}" font-weight="bold" fill="#fff">new</text></g>`
  );
}

type Column = Row & { kind: "column" };
const keyText = (r: Column): string => (r.key ? "PK" : r.fk ? "FK" : "");

/** A table's cell widths (type, name, key, and note when any row has one) and its size. */
interface Grid {
  cols: number[];
  w: number;
  h: number;
}

function grid(e: Entity): Grid {
  const rows = e.rows.filter((r): r is Column => r.kind === "column");
  const widest = (texts: number[]): number => Math.max(0, ...texts) + 2 * PAD;
  const cols = [
    widest(rows.map((r) => textW(r.type, FONT, false))),
    widest(rows.map((r) => textW(r.name, FONT, false) + (r.change === "new" ? BADGE_W + 6.0 : 0))),
    widest([textW("PK", FONT, false)]),
  ];
  if (rows.some((r) => r.note !== "")) cols.push(widest(rows.map((r) => textW(r.note, FONT, false))));
  const head = textW(e.name, FONT, false) + 2 * PAD + (e.change === "new" ? 2 * (BADGE_W + 8.0) : 0);
  const sum = cols.reduce((a, b) => a + b, 0);
  if (head > sum) cols[1]! += head - sum;
  const h = HEAD + e.rows.reduce((s, r) => s + (r.kind === "separator" ? SEP : ROW), 0);
  return { cols, w: Math.max(head, sum), h };
}

/** Each row's band top, by row; separators included. */
function rowTops(e: Entity, top: number): number[] {
  let y = top + HEAD;
  return e.rows.map((r) => {
    const t = y;
    y += r.kind === "separator" ? SEP : ROW;
    return t;
  });
}

function drawEntity(e: Entity, i: number, g: Grid, l: number, top: number): string {
  const deleted = e.change === "deleted";
  const dash = dashAttr(deleted);
  const [border, tint] = deleted ? ["#000", "none"] : PALETTE[i % PALETTE.length]!;
  const line = (x1: number, y1: number, x2: number, y2: number): string =>
    `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${border}" stroke-width="1.2"${dash}/>`;
  const out = [`<g data-entity="${esc(e.name)}">`];
  out.push(`<rect x="${f(l)}" y="${f(top)}" width="${f(g.w)}" height="${f(g.h)}" fill="${tint}" stroke="${border}" stroke-width="1.6"${dash}/>`);
  out.push(textEl(l + g.w / 2, top + HEAD / 2 + 5.0, [seg(e.name)], MIDDLE).svg);
  if (e.change === "new") out.push(badge(l + g.w - PAD - BADGE_W, top + HEAD / 2));
  const xs = g.cols.reduce<number[]>((acc, c) => [...acc, acc[acc.length - 1]! + c], [l]);
  const tops = rowTops(e, top);
  e.rows.forEach((r, k) => {
    const y = tops[k]!;
    if (r.kind === "separator") {
      out.push(line(l, y, l + g.w, y));
      return;
    }
    const mid = y + ROW / 2;
    const cells = [r.type, r.name, keyText(r), r.note];
    let row = `<g data-column="${esc(r.name)}" data-y="${f(y)}" data-h="${f(ROW)}">${line(l, y, l + g.w, y)}`;
    for (let c = 1; c < g.cols.length; c++) row += line(xs[c]!, y, xs[c]!, y + ROW);
    let nameRight = xs[1]! + PAD;
    cells.slice(0, g.cols.length).forEach((text, c) => {
      if (text === "") return;
      const t = textEl(xs[c]! + PAD, mid + 5.0, [seg(text)], PLAIN);
      if (c === 1) nameRight = t.right;
      row += t.svg;
    });
    if (r.change === "new") row += badge(nameRight + 6.0, mid);
    if (r.change === "deleted") row += `<line x1="${f(l + PAD - 2.0)}" y1="${f(mid)}" x2="${f(xs[2]! - PAD + 2.0)}" y2="${f(mid)}" ${STROKE}${dashAttr(true)}/>`;
    out.push(`${row}</g>`);
  });
  out.push("</g>");
  return out.join("");
}

/**
 * Crow's-foot marks at `p` on a box edge, `u` the unit vector pointing away from
 * the box, reaching `half` either side of the line.
 */
function marks(end: End, p: Pt, u: Pt, half = 7.0): string {
  const at = (d: number, s: number): Pt => ({ x: p.x + u.x * d - u.y * s, y: p.y + u.y * d + u.x * s });
  const line = (a: Pt, b: Pt): string => `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" ${STROKE}/>`;
  const bar = (d: number): string => line(at(d, -half + 1), at(d, half - 1));
  const out: string[] = [];
  if (end.many) out.push(line(at(12, 0), at(0, -half)), line(at(12, 0), at(0, half)));
  else out.push(bar(6));
  const d = end.many ? 18 : 14;
  if (end.optional) {
    const c = at(d + 4, 0);
    out.push(`<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(Math.min(4, half - 1))}" fill="#fff" ${STROKE}/>`);
  } else out.push(bar(d));
  return out.join("");
}

/** The route's corners, start to tip: every run between two is horizontal or vertical. */
const routePoints = (r: Route): Pt[] => [r.start, ...r.segs.map((s) => s.to)];

function routePath(r: Route): string {
  const pts = routePoints(r);
  let d = `M${f(pts[0]!.x)} ${f(pts[0]!.y)}`;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!, pts[i]!];
    if (a.x === b.x && a.y === b.y) continue;
    d += a.y === b.y ? `H${f(b.x)}` : `V${f(b.y)}`;
  }
  return d;
}

/** The label's first choice: the middle of the route's longest vertical run, or of its gap crossing when it runs straight across. */
function middle(r: Route): Pt {
  const pts = routePoints(r);
  let best: Pt = { x: (r.start.x + RUN + r.tip.x - RUN) / 2, y: r.start.y };
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!, pts[i]!];
    if (a.x === b.x && Math.abs(b.y - a.y) > len) [best, len] = [{ x: a.x, y: (a.y + b.y) / 2 }, Math.abs(b.y - a.y)];
  }
  return best;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LABEL = 12.0;
/** Clearance kept around a label's white backing. */
const CLEAR = 2.0;

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function crosses(p: Pt, q: Pt, r: Pt, s: Pt): boolean {
  const o = (a: Pt, b: Pt, c: Pt): number => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0;
}

function hits(line: readonly Pt[], b: Rect): boolean {
  const inside = (a: Pt): boolean => a.x > b.x && a.x < b.x + b.w && a.y > b.y && a.y < b.y + b.h;
  const c: Pt[] = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
  return line.some((p, i) => inside(p) || (i > 0 && c.some((a, k) => crosses(line[i - 1]!, p, a, c[(k + 1) % 4]!))));
}

/** The white backing textEl draws behind a label centred on `m`, grown by CLEAR. */
function labelRect(m: Pt, w: number): Rect {
  const y = m.y + 4.0;
  return { x: m.x - w / 2 - 3.0 - CLEAR, y: y - LABEL * 0.85 - CLEAR, w: w + 6.0 + 2 * CLEAR, h: LABEL * 1.1 + 2 * CLEAR };
}

/**
 * Where a label of width `w` reads cleanly: on its own line, between the marks
 * at either end, nearest the middle first, then above, below or beside it anywhere; the first spot
 * clear of every box, every label already placed and every other line wins.
 * With none clear, the spot with the fewest clashes.
 */
function placeLabel(own: Route, line: readonly Pt[], w: number, blocks: readonly Rect[], lines: readonly (readonly Pt[])[]): Pt {
  const lo = own.start.x + RUN + 4.0;
  const hi = own.tip.x - RUN - 4.0;
  const along: Pt[] = [];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1]!, line[i]!];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4.0));
    for (let k = 0; k < n; k++) along.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  const mid = middle(own);
  const near = (p: Pt, q: Pt): number => Math.hypot(p.x - mid.x, p.y - mid.y) - Math.hypot(q.x - mid.x, q.y - mid.y);
  along.sort(near);
  // Beside the line, the backing keeps clear of it and of the marks, which reach 7 either side.
  const above = (LABEL * 1.1) / 2 + CLEAR + 8.0;
  const aside = w / 2 + 3.0 + CLEAR + 4.0;
  const cands = [
    mid,
    ...along.filter((p) => p.x >= lo && p.x <= hi),
    ...along.flatMap((p) => [
      { x: p.x, y: p.y - above },
      { x: p.x, y: p.y + above },
      { x: p.x - aside, y: p.y },
      { x: p.x + aside, y: p.y },
    ]),
  ];
  // A label on its line sits on one straight run, so the line is seen to go in and come out.
  const corners = line.slice(1, -1);
  const within = (p: Pt, r: Rect): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  let best = mid;
  let bestN = Infinity;
  for (const c of cands) {
    const r = labelRect(c, w);
    const n = blocks.filter((b) => overlaps(r, b)).length + lines.filter((l) => hits(l, r)).length + corners.filter((p) => within(p, r)).length;
    if (n === 0) return c;
    if (n < bestN) [best, bestN] = [c, n];
  }
  return best;
}

/**
 * One gap crossing: from `ya` to `yb`, turning along the vertical channel at `x`.
 * A self-relation's loop has both runs on one side of its channel: the gap's left
 * for a loop off a table's right side (`loop` 1), its right for one off the left (-1).
 */
interface Hop {
  ya: number;
  yb: number;
  x: number;
  loop?: 1 | -1;
}

/** The ys of a hop's runs reaching left of its channel, and right of it. */
const leftRuns = (h: Hop): number[] => (h.loop === 1 ? [h.ya, h.yb] : h.loop === -1 ? [] : [h.ya]);
const rightRuns = (h: Hop): number[] => (h.loop === -1 ? [h.ya, h.yb] : h.loop === 1 ? [] : [h.yb]);

/**
 * Crossings between two hops turning in one gap, `p`'s channel left of `q`'s: the
 * runs right of `p`'s channel against `q`'s, and the runs left of `q`'s against `p`'s.
 */
function hopCrossings(p: Hop, q: Hop): number {
  const within = (y: number, h: Hop): boolean => y > Math.min(h.ya, h.yb) && y < Math.max(h.ya, h.yb);
  return rightRuns(p).filter((y) => within(y, q)).length + leftRuns(q).filter((y) => within(y, p)).length;
}

/** Most hops in one gap whose every order is tried; beyond it, neighbours swap while that removes crossings. */
const MAX_ORDER = 7;

/** The hops of one gap, left to right, in the order with fewest crossings; ties keep the given order. */
function channelOrder(hops: readonly Hop[]): Hop[] {
  const cost = (a: number, b: number): number => hopCrossings(hops[a]!, hops[b]!);
  if (hops.length <= MAX_ORDER) {
    let best: number[] = [];
    let bestC = Infinity;
    const walk = (order: number[], c: number): void => {
      if (c >= bestC) return;
      if (order.length === hops.length) [best, bestC] = [order, c];
      for (let i = 0; i < hops.length; i++)
        if (!order.includes(i)) walk([...order, i], c + order.reduce((s, j) => s + cost(j, i), 0));
    };
    walk([], 0);
    return best.map((i) => hops[i]!);
  }
  const order = hops.map((_, i) => i);
  for (let swapped = true; swapped; ) {
    swapped = false;
    for (let i = 0; i + 1 < order.length; i++) {
      const [a, b] = [order[i]!, order[i + 1]!];
      if (cost(b, a) < cost(a, b)) [order[i], order[i + 1], swapped] = [b, a, true];
    }
  }
  return order.map((i) => hops[i]!);
}

/** Most relations whose every orientation is tried; beyond it, each points from lower to higher table index, which never cycles. */
const MAX_FLIP = 10;

/**
 * Lay the tables out with each relation pointing whichever way gives the fewest
 * crossings between the lines as drawn (`score`, since row ends move them off the
 * layout's ports), then the fewest turned from their preferred way (`pairs` as given:
 * the "one" table left of the "many"), then the fewest layers. Layout wants edges from a lower index to a higher one, so each
 * orientation renumbers the tables in a topological order, ties by table index.
 * Boxes come back by table index and routes by relation.
 */
function orientedLayout(
  sizes: readonly Size[],
  pairs: readonly (readonly [number, number])[],
  opts: Parameters<typeof layout>[2],
  score: (lay: Layout) => number,
): Layout {
  const n = sizes.length;
  if (pairs.length > MAX_FLIP) pairs = pairs.map(([a, b]) => [Math.min(a, b), Math.max(a, b)]);
  const tries = pairs.length > MAX_FLIP ? 1 : 2 ** pairs.length;
  let best: { lay: Layout; key: number[] } | null = null;
  for (let mask = 0; mask < tries; mask++) {
    const dirs = pairs.map(([a, b], k): [number, number] => ((mask >> k) & 1 ? [b, a] : [a, b]));
    const indeg = new Array<number>(n).fill(0);
    for (const [, b] of dirs) indeg[b]!++;
    const rank = new Array<number>(n).fill(-1);
    const order: number[] = [];
    while (order.length < n) {
      const v = indeg.findIndex((d, i) => d === 0 && rank[i] === -1);
      if (v < 0) break;
      rank[v] = order.length;
      order.push(v);
      for (const [a, b] of dirs) if (a === v) indeg[b]!--;
    }
    if (order.length < n) continue; // a cycle
    const lay = layout(
      order.map((v) => sizes[v]!),
      dirs.map(([a, b]): [number, number] => [rank[a]!, rank[b]!]),
      opts,
    );
    const back: Layout = {
      ...lay,
      boxes: sizes.map((_, i) => lay.boxes[rank[i]!]!),
      routes: lay.routes.map((r) => ({ ...r, from: order[r.from]!, to: order[r.to]! })),
    };
    const key = [score(back), mask.toString(2).split("1").length - 1, lay.order.length];
    if (!best || cmp(key, best.key) < 0) best = { key, lay: back };
  }
  return best!.lay;
}

function cmp(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** Centre y of the row `col` names, or of the header for null. */
function endY(e: Entity, top: number, col: string | null): number {
  const k = col === null ? -1 : e.rows.findIndex((r) => r.kind === "column" && r.name === col);
  return k < 0 ? top + HEAD / 2 : rowTops(e, top)[k]! + ROW / 2;
}

export function render(model: Model): string {
  const grids = model.entities.map(grid);
  const titleY = 32.0;
  const top0 = model.title === "" ? MARGIN : titleY + 24.0;
  // A relation is drawn the same either way round; it prefers its "one" table left of its "many", else table order.
  const between = model.relations.filter((r) => r.from.entity !== r.to.entity);
  const edges = between.map((r): [number, number] =>
    r.from.many !== r.to.many ? (r.to.many ? [r.from.entity, r.to.entity] : [r.to.entity, r.from.entity]) : [Math.min(r.from.entity, r.to.entity), Math.max(r.from.entity, r.to.entity)],
  );
  // A self-relation loops off its table's side, along a channel of its own, drawn after the others.
  const selves = model.relations.filter((r) => r.from.entity === r.to.entity);
  const rels = [...between, ...selves];
  // A gap between layers holds the marks at both ends and the widest label between them.
  const widest = Math.max(0, ...between.map((r) => (r.label === "" ? 0 : textW(r.label, LABEL, false))));
  // It also holds a vertical channel per relation turning in it, a channel apart.
  const gap = Math.max(110.0, 2 * RUN + widest + 40.0, 2 * RUN + CHANNEL * (Math.min(between.length, 8) + 1));
  // The layout runs top to bottom: hand it each table turned on its side, then turn the result back.
  type Side = { k: number; end: 0 | 1 };
  /**
   * The tables where `lay` puts them, every line as drawn (relations between tables,
   * then self-relations), each end's mark half-height, and the way each end's marks face.
   */
  const draw = (lay: Layout): { boxes: Rect[]; routes: Route[]; half: number[][]; face: [number, number][] } => {
    const turn = (p: Pt): Pt => ({ x: p.y, y: p.x - lay.minX });
    const boxes: Rect[] = lay.boxes.map((b) => ({ x: b.top, y: b.cx - b.w / 2 - lay.minX, w: b.h, h: b.w }));

    // Each end's y: its row, or the header. Several table-level ends on one side are
    // spread down it in the layout's port order, header first, then rows no row end
    // on that side uses; when those run out, evenly down the whole side with marks
    // narrowed to fit, so no two crow's feet overlap.
    const ys = between.map((rel, k) => {
      const r = lay.routes[k]!;
      const [left, right] = rel.from.entity === r.from ? [rel.from, rel.to] : [rel.to, rel.from];
      return [left, right].map((e) => endY(model.entities[e.entity]!, boxes[e.entity]!.y, e.column));
    });
    const half = rels.map(() => [7.0, 7.0]);
    const sides = new Map<string, Side[]>();
    between.forEach((_, k) => {
      const r = lay.routes[k]!;
      for (const [end, ent] of [[0, r.from], [1, r.to]] as const) {
        const key = `${ent}:${end}`;
        sides.set(key, [...(sides.get(key) ?? []), { k, end }]);
      }
    });
    // A self-relation's loop leaves the side of its table with fewer relation ends
    // (the right on a tie), and its ends spread on that side with the rest.
    const loopDir = selves.map((rel): 1 | -1 => {
      const ent = rel.from.entity;
      return lay.routes.filter((r) => r.from === ent).length <= lay.routes.filter((r) => r.to === ent).length ? 1 : -1;
    });
    selves.forEach((rel, s) => {
      const ent = rel.from.entity;
      const e = model.entities[ent]!;
      ys.push([endY(e, boxes[ent]!.y, rel.from.column), endY(e, boxes[ent]!.y, rel.to.column)]);
      const key = `${ent}:${loopDir[s]! > 0 ? 0 : 1}`;
      const k = between.length + s;
      sides.set(key, [...(sides.get(key) ?? []), { k, end: 0 }, { k, end: 1 }]);
    });
    const column = (x: Side): string | null => {
      if (x.k >= between.length) {
        const rel = selves[x.k - between.length]!;
        return x.end === 0 ? rel.from.column : rel.to.column;
      }
      const rel = between[x.k]!;
      const r = lay.routes[x.k]!;
      return rel.from.entity === (x.end === 0 ? r.from : r.to) ? rel.from.column : rel.to.column;
    };
    for (const [key, ends] of sides) {
      const tableLevel = ends.filter((x) => column(x) === null);
      if (tableLevel.length < 2) continue;
      const ent = Number(key.split(":")[0]);
      const e = model.entities[ent]!;
      const b = boxes[ent]!;
      const used = new Set(ends.map(column));
      let slots = [null, ...e.rows.flatMap((r) => (r.kind === "column" && !used.has(r.name) ? [r.name] : []))].map((c) => endY(e, b.y, c));
      let w = 7.0;
      if (slots.length < tableLevel.length) {
        const step = b.h / (tableLevel.length + 1);
        slots = tableLevel.map((_, i) => b.y + step * (i + 1));
        w = Math.min(7.0, step / 2 - 1.0);
      }
      // A loop's ends take the first slots, side by side, so no other end sits between them.
      const port = (x: Side): number => (x.k >= between.length ? -Infinity : x.end === 0 ? lay.routes[x.k]!.start.x : lay.routes[x.k]!.tip.x);
      tableLevel.sort((p, q) => port(p) - port(q) || p.k - q.k || p.end - q.end);
      tableLevel.forEach((x, i) => {
        ys[x.k]![x.end] = slots[i]!;
        half[x.k]![x.end] = w;
      });
    }

    // Several ends on one row and side spread down its band, ordered by where their
    // other ends sit, with marks narrowed to fit, so no two crow's feet overprint.
    const before = ys.map((p) => [...p]);
    for (const [key, ends] of sides) {
      const ent = Number(key.split(":")[0]);
      const e = model.entities[ent]!;
      const tops = rowTops(e, boxes[ent]!.y);
      const byRow = new Map<string, typeof ends>();
      for (const x of ends) {
        const col = column(x);
        if (col !== null) byRow.set(col, [...(byRow.get(col) ?? []), x]);
      }
      for (const [col, xs] of byRow) {
        if (xs.length < 2) continue;
        const top = tops[e.rows.findIndex((r) => r.kind === "column" && r.name === col)]!;
        const step = ROW / (xs.length + 1);
        xs.sort((p, q) => before[p.k]![1 - p.end]! - before[q.k]![1 - q.end]! || p.k - q.k || p.end - q.end);
        xs.forEach((x, i) => {
          ys[x.k]![x.end] = top + step * (i + 1);
          half[x.k]![x.end] = Math.min(7.0, step / 2 - 0.5);
        });
      }
    }

    // Each route crosses one gap per layer it passes: out of its row (or a pass
    // through the layer beside the tables), along a vertical channel of its own in
    // the gap, and on at the next row or pass. Channels share out the gap's free
    // middle, between the runs that carry the marks, in the order with fewest crossings.
    const hops: Hop[][] = [];
    const gaps = new Map<number, { lo: number; hi: number; hops: Hop[] }>();
    lay.routes.forEach((r, k) => {
      const [ys0, ys1] = ys[k]! as [number, number];
      let cur = turn(r.start);
      let y = ys0;
      const mine: Hop[] = [];
      r.segs.forEach((s, i) => {
        const to = turn(s.to);
        if (s.kind === "curve") {
          const last = i === r.segs.length - 2;
          const hop: Hop = { ya: y, yb: last ? ys1 : to.y, x: 0 };
          y = hop.yb;
          mine.push(hop);
          const g = gaps.get(cur.x) ?? { lo: cur.x + RUN, hi: last ? to.x : to.x - RUN, hops: [] };
          g.hops.push(hop);
          gaps.set(cur.x, g);
        }
        cur = to;
      });
      hops.push(mine);
    });
    // A loop turns in the gap on its side, among the hops there; off the outer side
    // of the picture, or of a gap nothing crosses, its channel hugs the table.
    const layerRight = (l: number): number => Math.max(...boxes.filter((_, i) => lay.boxes[i]!.layer === l).map((b) => b.x + b.w));
    const outer = new Map<string, { edge: number; dir: 1 | -1; hops: Hop[] }>();
    const loopEdge: number[] = [];
    selves.forEach((rel, s) => {
      const ent = rel.from.entity;
      const dir = loopDir[s]!;
      const l = lay.boxes[ent]!.layer;
      const edge = dir > 0 ? layerRight(l) : boxes[ent]!.x;
      const [ya, yb] = ys[between.length + s]! as [number, number];
      const hop: Hop = { ya, yb, x: 0, loop: dir };
      hops.push([hop]);
      loopEdge.push(dir > 0 ? boxes[ent]!.x + boxes[ent]!.w : boxes[ent]!.x);
      const g = dir > 0 ? gaps.get(edge) : l > 0 ? gaps.get(layerRight(l - 1)) : undefined;
      if (g) g.hops.push(hop);
      else {
        const key = `${l}:${dir}`;
        const o = outer.get(key) ?? { edge, dir, hops: [] };
        o.hops.push(hop);
        outer.set(key, o);
      }
    });
    const spread = (g: { lo: number; hi: number; hops: Hop[] }): void => {
      const turning = channelOrder(g.hops.filter((h) => h.ya !== h.yb));
      turning.forEach((h, i) => (h.x = g.lo + ((g.hi - g.lo) * (i + 1)) / (turning.length + 1)));
    };
    for (const g of gaps.values()) spread(g);
    for (const o of outer.values()) {
      // One channel apart, the nearest LOOP off the table.
      const span = CHANNEL * (o.hops.length + 1);
      const lo = o.dir > 0 ? o.edge + LOOP - CHANNEL : o.edge - LOOP + CHANNEL - span;
      spread({ lo, hi: lo + span, hops: o.hops });
    }
    const routes: Route[] = lay.routes.map((r, k) => {
      const [ys0, ys1] = ys[k]! as [number, number];
      const start = { x: turn(r.start).x, y: ys0 };
      const tip = { x: turn(r.tip).x, y: ys1 };
      const segs: Route["segs"] = [];
      for (const h of hops[k]!) if (h.ya !== h.yb) segs.push({ kind: "line", to: { x: h.x, y: h.ya } }, { kind: "line", to: { x: h.x, y: h.yb } });
      segs.push({ kind: "line", to: tip });
      return { from: r.from, to: r.to, start, segs, tip };
    });
    selves.forEach((rel, s) => {
      const k = between.length + s;
      const [ys0, ys1] = ys[k]! as [number, number];
      const x = hops[k]![0]!.x;
      const [start, tip] = [{ x: loopEdge[s]!, y: ys0 }, { x: loopEdge[s]!, y: ys1 }];
      routes.push({ from: rel.from.entity, to: rel.to.entity, start, segs: [{ kind: "line", to: { x, y: ys0 } }, { kind: "line", to: { x, y: ys1 } }, { kind: "line", to: tip }], tip });
    });
    const face = rels.map((_, k): [number, number] => (k < between.length ? [1, -1] : [loopDir[k - between.length]!, loopDir[k - between.length]!]));

    return { boxes, routes, half, face };
  };
  const drawnCrossings = (lay: Layout): number => {
    const pieces = draw(lay).routes.map(routePoints);
    let c = 0;
    for (let i = 0; i < pieces.length; i++)
      for (let j = i + 1; j < pieces.length; j++)
        if (pieces[i]!.some((p, a) => a > 0 && pieces[j]!.some((q, b) => b > 0 && crosses(pieces[i]![a - 1]!, p, pieces[j]![b - 1]!, q)))) c++;
    return c;
  };
  const lay = orientedLayout(
    grids.map((g) => ({ w: g.h, h: g.w })),
    edges,
    { top: 0, stub: RUN, gapY: gap, gapX: 40, gapVirtual: 24 },
    drawnCrossings,
  );
  const { boxes, routes, half, face } = draw(lay);

  let [minX, maxX, minY, maxY] = [0, lay.bottom, 0, lay.maxX - lay.minX];
  const grow = (r: Rect): void => {
    [minX, maxX] = [Math.min(minX, r.x), Math.max(maxX, r.x + r.w)];
    [minY, maxY] = [Math.min(minY, r.y), Math.max(maxY, r.y + r.h)];
  };
  boxes.forEach(grow);

  const lines = routes.map(routePoints);
  // Self-relation loops may reach past the tables.
  for (const p of lines.flat()) grow({ x: p.x, y: p.y - 8, w: 0, h: 16 });
  const blocks: Rect[] = [...boxes];
  // The crow's-foot marks at both ends of every relation, on the side each faces.
  const markBox = (p: Pt, u: number): Rect => ({ x: u > 0 ? p.x : p.x - RUN, y: p.y - 8, w: RUN, h: 16 });
  routes.forEach((r, k) => blocks.push(markBox(r.start, face[k]![0]), markBox(r.tip, face[k]![1])));
  const relSvgs = rels.map((rel, k) => {
    const route = routes[k]!;
    const [first, last] = rel.from.entity === route.from ? [rel.from, rel.to] : [rel.to, rel.from];
    const [u0, u1] = face[k]!;
    const out = [`<g class="relation"><path d="${routePath(route)}" data-marks="${f(half[k]![0]!)} ${f(half[k]![1]!)}" fill="none" ${STROKE}${dashAttr(rel.dashed)}/>`];
    out.push(marks(first, route.start, { x: u0, y: 0 }, half[k]![0]), marks(last, route.tip, { x: u1, y: 0 }, half[k]![1]));
    if (rel.label !== "") {
      const w = textW(rel.label, LABEL, false);
      const m = placeLabel(route, lines[k]!, w, blocks, lines.filter((_, j) => j !== k));
      blocks.push(labelRect(m, w));
      grow(labelRect(m, w));
      out.push(textEl(m.x, m.y + 4.0, [seg(rel.label)], { ...MIDDLE, size: LABEL, bg: true }).svg);
    }
    out.push("</g>");
    return out.join("");
  });

  const entSvgs = model.entities.map((e, i) => drawEntity(e, i, grids[i]!, boxes[i]!.x, boxes[i]!.y));

  const fronts: string[] = [];
  if (model.title !== "") {
    const t = textEl((minX + maxX) / 2, minY - top0 + titleY, [bold(model.title)], { ...MIDDLE, size: 16.0 });
    [minX, maxX] = [Math.min(minX, t.left), Math.max(maxX, t.right)];
    fronts.push(t.svg);
  }

  const width = displayFloat(Math.ceil(maxX - minX + 2 * MARGIN));
  const height = displayFloat(Math.ceil(top0 + maxY - minY + MARGIN));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FAMILY}" font-size="${FONT}" fill="#000">`,
    `<rect width="${width}" height="${height}" fill="#fff"/>`,
    `<g transform="translate(${f(MARGIN - minX)} ${f(top0 - minY)})">`,
    ...fronts,
    ...relSvgs,
    ...entSvgs,
    "</g>",
    "</svg>",
    "",
  ].join("\n");
}
