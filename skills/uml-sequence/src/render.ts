// Lay out a parsed sequence Diagram and draw it as SVG.
// Ported from the Rust uml-sequence renderer; float expressions keep the original
// operation order so the output is byte-identical.
import { arrowHead, bold, dashAttr, FAMILY, FONT, MIDDLE, PLAIN, seg, textEl, type Seg, type TextOpts } from "./svg.ts";
import { displayFloat, f, fmax, fmin, splitLines, textW } from "./text.ts";
import { STEREO, type Diagram, type Ev, type Frag, type Msg, type Note, type Part, type Section } from "./parse.ts";

const SMALL = 12.0;
const LINE = 19.0;
const PAD = 8.0;
const SELF_W = 30.0;
const FRAME_PAD = 14.0;
const FLOW_GAP = 56.0;

export class RenderError extends Error {}

// ---------------------------------------------------------------- measuring

function msgLines(m: Msg): string[] {
  return m.lines.length === 1 && m.lines[0] === "" && m.num === null ? [] : m.lines;
}
function numText(m: Msg): string {
  return m.num === null ? "" : `${m.num}. `;
}
function labelW(m: Msg): number {
  return msgLines(m)
    .map((l, k) => textW(l, FONT, false) + (k === 0 ? textW(numText(m), FONT, true) : 0.0))
    .reduce(fmax, 0.0);
}
function noteW(n: Note): number {
  return n.lines.map((l) => textW(l, FONT, false)).reduce(fmax, -Infinity) + 2.0 * PAD + 8.0;
}
function guardW(s: Section): number {
  return s.guard === "" ? 0.0 : textW(`[${s.guard}]`, FONT, false);
}

function walk(evs: readonly Ev[], fun: (e: Ev) => void): void {
  for (const e of evs) {
    fun(e);
    if (e.type === "frag") for (const s of e.sections) walk(s.events, fun);
  }
}

interface Head {
  w: number;
  h: number;
  lines: string[];
  stereo: string | null;
}

function measureHead(p: Part): Head {
  const lines = splitLines(p.name);
  const nameW = lines.map((l) => textW(l, FONT, false)).reduce(fmax, -Infinity);
  if (p.kind === "actor") {
    return { w: fmax(nameW, 40.0) + 2.0 * PAD, h: 44.0 + lines.length * LINE, lines, stereo: null };
  }
  const stereo = STEREO.includes(p.kind) ? `«${p.kind}»` : null;
  const stW = stereo === null ? 0.0 : textW(stereo, SMALL, false);
  const w = fmax(fmax(nameW, stW) + 2.0 * PAD + 8.0, 70.0);
  const h = lines.length * LINE + 2.0 * PAD + (stereo !== null ? LINE - 4.0 : 0.0) + (p.kind === "database" ? 12.0 : 0.0);
  return { w, h, lines, stereo };
}

/** Column gaps: start from header widths, then widen until every label fits its span. */
function columnXs(d: Diagram, heads: readonly Head[]): number[] {
  const n = d.parts.length;
  const g: number[] = [];
  for (let i = 0; i < n - 1; i++) g.push((heads[i]!.w + heads[i + 1]!.w) / 2.0 + 24.0);
  const cons: [number, number, number][] = [];
  walk(d.events, (e) => {
    if (e.type === "msg") {
      const [a, b] = [e.from, e.to];
      if (a === b) {
        if (a < n - 1) cons.push([a, a + 1, SELF_W + 12.0 + labelW(e) + 16.0]);
      } else cons.push([Math.min(a, b), Math.max(a, b), labelW(e) + 40.0]);
    } else if (e.type === "note") {
      const i = e.targets[0]!;
      if (e.pos === "right" && i < n - 1) cons.push([i, i + 1, noteW(e) + 24.0]);
      if (e.pos === "left" && i > 0) cons.push([i - 1, i, noteW(e) + 24.0]);
    }
  });
  cons.sort((p, q) => p[1] - p[0] - (q[1] - q[0])); // stable, like sort_by_key
  for (const [a, b, need] of cons) {
    let cur = 0.0;
    for (let i = a; i < b; i++) cur += g[i]!;
    if (cur < need) {
      const add = (need - cur) / (b - a);
      for (let i = a; i < b; i++) g[i] = g[i]! + add;
    }
  }
  const x = [0.0];
  g.forEach((gap, i) => x.push(x[i]! + gap));
  return x;
}

// ---------------------------------------------------------------- renderer state

class Renderer {
  minX = Infinity;
  maxX = -Infinity;
  frames: string[] = [];
  bars: string[] = [];
  front: string[] = [];
  act: number[][];
  dividers: [number, string[]][] = [];
  y: number;
  lastArrow: number | null = null;
  warnings: string[] = [];
  readonly parts: readonly Part[];
  readonly x: readonly number[];
  readonly heads: readonly Head[];
  readonly headH: number;
  readonly rowsTop: number;
  readonly centerX: number;

  constructor(
    parts: readonly Part[],
    x: readonly number[],
    heads: readonly Head[],
    headH: number,
    rowsTop: number,
    centerX: number,
  ) {
    this.parts = parts;
    this.x = x;
    this.heads = heads;
    this.headH = headH;
    this.rowsTop = rowsTop;
    this.centerX = centerX;
    this.act = parts.map(() => []);
    this.y = rowsTop;
  }

  track(a: number, b: number): void {
    this.minX = fmin(this.minX, a);
    this.maxX = fmax(this.maxX, b);
  }

  text(x0: number, y: number, segs: readonly Seg[], o: TextOpts): string {
    const t = textEl(x0, y, segs, o);
    this.track(t.left, t.right);
    return t.svg;
  }

  noteBox(n: Note): [number, number] {
    const xs = n.targets.map((i) => this.x[i]!);
    const w = noteW(n);
    switch (n.pos) {
      case "over": {
        const lo = xs.reduce(fmin, Infinity);
        const hi = xs.reduce(fmax, -Infinity);
        const ww = fmax(w, hi - lo + (xs.length > 1 ? 40.0 : 0.0));
        return [(lo + hi) / 2.0 - ww / 2.0, ww];
      }
      case "right":
        return [xs[0]! + 12.0, w];
      case "left":
        return [xs[0]! - 12.0 - w, w];
    }
  }

  extent(evs: readonly Ev[]): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    const inc = (a: number, b: number): void => {
      lo = fmin(lo, a);
      hi = fmax(hi, b);
    };
    for (const e of evs) {
      switch (e.type) {
        case "msg": {
          const [a, b] = [this.x[e.from]!, this.x[e.to]!];
          if (e.from === e.to) inc(a, a + SELF_W + 12.0 + labelW(e));
          else inc(fmin(a, b), fmax(a, b));
          break;
        }
        case "note": {
          const [x0, w] = this.noteBox(e);
          inc(x0, x0 + w);
          break;
        }
        case "activate":
        case "deactivate":
          inc(this.x[e.part]! - 5.0, this.x[e.part]! + 5.0);
          break;
        case "frag": {
          const [l, r] = this.fragRect(e);
          inc(l, r);
          break;
        }
        default:
          break;
      }
    }
    return [lo, hi];
  }

  /** [left, right, tab width] */
  fragRect(fr: Frag): [number, number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of fr.sections) {
      const [a, b] = this.extent(s.events);
      lo = fmin(lo, a);
      hi = fmax(hi, b);
    }
    if (!Number.isFinite(lo)) {
      lo = this.x[0]!;
      hi = this.x[this.x.length - 1]!;
    }
    const l = lo - FRAME_PAD;
    const tabW = textW(fr.kind, FONT, true) + 20.0;
    let r = fmax(hi + FRAME_PAD, l + tabW + 8.0 + guardW(fr.sections[0]!) + 12.0);
    for (const s of fr.sections.slice(1)) r = fmax(r, l + 8.0 + guardW(s) + 12.0);
    return [l, r, tabW];
  }

  drawPart(i: number, top: number, isFoot: boolean): string {
    const cx = this.x[i]!;
    const { w, h, lines, stereo } = this.heads[i]!;
    const kind = this.parts[i]!.kind;
    const by = isFoot ? top : top + this.headH - h;
    const l = cx - w / 2.0;
    this.track(l, l + w);
    let out = "";
    if (kind === "actor") {
      out +=
        `<g fill="none" stroke="#000" stroke-width="1.2"><circle cx="${f(cx)}" cy="${f(by + 8.0)}" r="7" fill="#fff"/>` +
        `<path d="M${f(cx)} ${f(by + 15.0)}V${f(by + 28.0)}M${f(cx - 11.0)} ${f(by + 19.0)}H${f(cx + 11.0)}` +
        `M${f(cx - 9.0)} ${f(by + 40.0)}L${f(cx)} ${f(by + 28.0)}L${f(cx + 9.0)} ${f(by + 40.0)}"/></g>`;
      lines.forEach((t, k) => {
        out += this.text(cx, by + 44.0 + FONT - 1.0 + k * LINE, [seg(t)], MIDDLE);
      });
      return out;
    }
    let ty = by + PAD + FONT;
    if (kind === "database") {
      const r = w / 2.0;
      out +=
        `<path d="M${f(l)} ${f(by + 6.0)}A${f(r)} 6 0 0 1 ${f(l + w)} ${f(by + 6.0)}V${f(by + h - 6.0)}A${f(r)} 6 0 0 1 ${f(l)} ${f(by + h - 6.0)}Z" fill="#fff" stroke="#000" stroke-width="1.2"/>` +
        `<path d="M${f(l)} ${f(by + 6.0)}A${f(r)} 6 0 0 0 ${f(l + w)} ${f(by + 6.0)}" fill="none" stroke="#000" stroke-width="1.2"/>`;
      ty += 12.0;
    } else {
      out += `<rect x="${f(l)}" y="${f(by)}" width="${f(w)}" height="${f(h)}" fill="#fff" stroke="#000" stroke-width="1.2"/>`;
    }
    if (stereo !== null) {
      out += this.text(cx, ty - 2.0, [seg(stereo)], { ...MIDDLE, size: SMALL, italic: true });
      ty += LINE - 4.0;
    }
    lines.forEach((t, k) => {
      out += this.text(cx, ty + k * LINE, [seg(t)], MIDDLE);
    });
    return out;
  }

  /** x where an arrow meets participant `p`'s lifeline or its top activation bar. */
  edge(p: number, side: number): number {
    const d = this.act[p]!.length;
    return this.x[p]! + (d > 0.0 ? side * 5.0 + (d - 1.0) * 5.0 : 0.0);
  }

  closeBar(p: number, end: number): void {
    const stack = this.act[p]!;
    const depth = stack.length;
    const start = stack.pop();
    if (start === undefined) {
      this.warnings.push(`deactivate ${this.parts[p]!.id} without an active bar`);
      return;
    }
    const bx = this.x[p]! - 5.0 + (depth - 1.0) * 5.0;
    this.bars.push(
      `<rect x="${f(bx)}" y="${f(start)}" width="10" height="${f(fmax(end - start, 10.0))}" fill="#fff" stroke="#000" stroke-width="1.2"/>`,
    );
  }

  rows(evs: readonly Ev[]): void {
    for (const e of evs) {
      const prev = this.lastArrow;
      this.lastArrow = null;
      switch (e.type) {
        case "msg":
          this.msg(e);
          break;
        case "activate":
          this.act[e.part]!.push(prev ?? this.y);
          if (prev === null) this.y += 6.0;
          this.lastArrow = prev;
          break;
        case "deactivate":
          this.closeBar(e.part, prev ?? this.y);
          if (prev === null) this.y += 6.0;
          this.lastArrow = prev;
          break;
        case "divider":
          // A divider starts a separate flow: leave a wide gap so the flows read apart.
          this.y += this.y === this.rowsTop ? 8.0 : FLOW_GAP;
          this.dividers.push([this.y, e.lines]);
          this.y += e.lines.length * LINE + 30.0;
          break;
        case "delay":
          this.y += 6.0;
          e.lines.forEach((l, k) => {
            this.front.push(this.text(this.centerX, this.y + FONT + k * LINE, [seg(l)], { ...MIDDLE, italic: true, bg: true }));
          });
          this.y += Math.max(e.lines.length, 1) * LINE + 12.0;
          break;
        case "space":
          this.y += 24.0;
          break;
        case "note": {
          const [x0, w] = this.noteBox(e);
          const top = this.y + 4.0;
          const h = e.lines.length * LINE + 2.0 * PAD - 2.0;
          this.front.push(
            `<path d="M${f(x0)} ${f(top)}H${f(x0 + w - 8.0)}L${f(x0 + w)} ${f(top + 8.0)}V${f(top + h)}H${f(x0)}Z" fill="#fff" stroke="#000" stroke-width="1.2"/>` +
              `<path d="M${f(x0 + w - 8.0)} ${f(top)}V${f(top + 8.0)}H${f(x0 + w)}" fill="none" stroke="#000" stroke-width="1"/>`,
          );
          e.lines.forEach((l, k) => {
            this.front.push(this.text(x0 + PAD, top + PAD + FONT - 3.0 + k * LINE, [seg(l)], PLAIN));
          });
          this.track(x0, x0 + w);
          this.y = top + h + 12.0;
          break;
        }
        case "frag":
          this.frag(e);
          break;
      }
    }
  }

  msg(m: Msg): void {
    const lines = msgLines(m);
    const n = lines.length;
    const num = m.num === null ? null : `${m.num}.`;
    const draw = (x: number, y: number, k: number, l: string, o: TextOpts): void => {
      const segs: Seg[] = num !== null && k === 0 ? [bold(num), { s: l, bold: false, dx: 5.0 }] : [seg(l)];
      this.front.push(this.text(x, y, segs, o));
    };
    if (m.from === m.to) {
      const cx = this.edge(m.from, 1.0);
      const top = this.y + 4.0;
      const h = fmax(n * LINE - 2.0, 16.0);
      this.front.push(
        `<polyline points="${f(cx)},${f(top)} ${f(cx + SELF_W)},${f(top)} ${f(cx + SELF_W)},${f(top + h)} ${f(cx)},${f(top + h)}" fill="none" stroke="#000" stroke-width="1.2"${dashAttr(m.dashed)}/>`,
      );
      this.front.push(arrowHead(cx, top + h, -1.0, m.filled));
      lines.forEach((l, k) => draw(cx + SELF_W + 8.0, top + FONT - 3.0 + k * LINE, k, l, { ...PLAIN, bg: true }));
      this.lastArrow = top;
      this.y = top + h + 14.0;
      return;
    }
    this.y += n * LINE + 2.0;
    const ay = this.y;
    if (m.mark === "++") this.act[m.to]!.push(ay);
    const side = m.to > m.from ? 1.0 : -1.0;
    const [x1, x2] = [this.edge(m.from, side), this.edge(m.to, -side)];
    this.front.push(`<line x1="${f(x1)}" y1="${f(ay)}" x2="${f(x2)}" y2="${f(ay)}" stroke="#000" stroke-width="1.2"${dashAttr(m.dashed)}/>`);
    this.front.push(arrowHead(x2, ay, side, m.filled));
    const mid = (this.x[m.from]! + this.x[m.to]!) / 2.0;
    lines.forEach((l, k) => draw(mid, ay - 6.0 - (n - 1.0 - k) * LINE, k, l, { ...MIDDLE, bg: true }));
    if (m.mark === "--") this.closeBar(m.from, ay);
    this.lastArrow = ay;
    this.y = ay + 14.0;
  }

  frag(fr: Frag): void {
    const [l, r, tabW] = this.fragRect(fr);
    this.track(l, r);
    this.y += 6.0;
    const top = this.y;
    const tabH = LINE + 4.0;
    this.front.push(
      `<path d="M${f(l)} ${f(top)}H${f(l + tabW)}V${f(top + tabH - 7.0)}L${f(l + tabW - 7.0)} ${f(top + tabH)}H${f(l)}Z" fill="#fff" stroke="#000" stroke-width="1.2"/>`,
    );
    this.front.push(this.text(l + 8.0, top + FONT + 1.0, [bold(fr.kind)], PLAIN));
    const first = fr.sections[0]!;
    if (first.guard !== "") {
      this.front.push(this.text(l + tabW + 8.0, top + FONT + 1.0, [seg(`[${first.guard}]`)], { ...PLAIN, bg: true }));
    }
    this.y = top + tabH + 10.0;
    fr.sections.forEach((s, i) => {
      if (i > 0) {
        this.y += 2.0;
        this.frames.push(
          `<line x1="${f(l)}" y1="${f(this.y)}" x2="${f(r)}" y2="${f(this.y)}" stroke="#000" stroke-width="1" stroke-dasharray="4 3"/>`,
        );
        if (s.guard !== "") {
          this.front.push(this.text(l + 8.0, this.y + FONT + 2.0, [seg(`[${s.guard}]`)], { ...PLAIN, bg: true }));
        }
        this.y += LINE + 10.0;
      }
      this.rows(s.events);
    });
    this.y += 4.0;
    this.frames.push(
      `<rect x="${f(l)}" y="${f(top)}" width="${f(r - l)}" height="${f(this.y - top)}" fill="none" stroke="#000" stroke-width="1.2"/>`,
    );
    this.y += 8.0;
  }
}

// ---------------------------------------------------------------- entry

export interface RenderResult {
  svg: string;
  /** Layout warnings (e.g. a deactivate with no open bar), after the parse warnings. */
  warnings: string[];
}

/** Render a diagram to SVG. Throws RenderError when there is nothing to draw. */
export function render(d: Diagram): RenderResult {
  const n = d.parts.length;
  if (n === 0) throw new RenderError("no participants or messages found");
  const heads = d.parts.map(measureHead);
  const headH = heads.map((h) => h.h).reduce(fmax, -Infinity);
  const x = columnXs(d, heads);

  const titleH = d.title === null ? 0.0 : d.title.length * 22.0 + 16.0;
  const top0 = 16.0 + titleH;
  const rowsTop = top0 + headH + 18.0;
  const centerX = (x[0]! + x[n - 1]!) / 2.0;
  const r = new Renderer(d.parts, x, heads, headH, rowsTop, centerX);

  const headSvgs = d.parts.map((_, i) => r.drawPart(i, top0, false));
  r.rows(d.events);
  r.y += 6.0;
  for (let p = 0; p < n; p++) while (r.act[p]!.length > 0) r.closeBar(p, r.y);
  r.y += 8.0;
  const lifeTop = top0 + headH;
  const lifelines = d.parts.map(
    (_, p) => `<line x1="${f(x[p]!)}" y1="${f(lifeTop)}" x2="${f(x[p]!)}" y2="${f(r.y)}" stroke="#000" stroke-width="1"${dashAttr(true)}/>`,
  );
  const footTop = r.y;
  const footSvgs = d.footbox ? d.parts.map((_, i) => r.drawPart(i, footTop, true)) : [];
  const maxH = heads.map((h) => h.h).reduce(fmax, -Infinity);
  const bottom = (d.footbox ? r.y + maxH : r.y) + 16.0;

  const dividers = r.dividers;
  r.dividers = [];
  for (const [dy, lines] of dividers) {
    const mid = dy + (lines.length * LINE) / 2.0 + 4.0;
    const [a, b] = [f(r.minX), f(r.maxX)];
    r.frames.push(
      `<line x1="${a}" y1="${f(mid - 2.0)}" x2="${b}" y2="${f(mid - 2.0)}" stroke="#000" stroke-width="1"/>` +
        `<line x1="${a}" y1="${f(mid + 2.0)}" x2="${b}" y2="${f(mid + 2.0)}" stroke="#000" stroke-width="1"/>`,
    );
    if (lines.some((l) => l !== "")) {
      const w = lines.map((l) => textW(l, FONT, true)).reduce(fmax, -Infinity) + 2.0 * PAD + 8.0;
      const h = lines.length * LINE + 8.0;
      r.front.push(
        `<rect x="${f(centerX - w / 2.0)}" y="${f(mid - h / 2.0)}" width="${f(w)}" height="${f(h)}" fill="#fff" stroke="#000" stroke-width="1.2"/>`,
      );
      lines.forEach((l, k) => {
        r.front.push(r.text(centerX, mid - h / 2.0 + 4.0 + FONT - 1.0 + k * LINE, [bold(l)], MIDDLE));
      });
    }
  }
  if (d.title !== null) {
    const cx = (r.minX + r.maxX) / 2.0;
    d.title.forEach((l, k) => {
      r.front.push(r.text(cx, 16.0 + 16.0 + k * 22.0, [bold(l)], { ...MIDDLE, size: 16.0 }));
    });
  }

  const margin = 20.0;
  const w = displayFloat(Math.ceil(r.maxX - r.minX + 2.0 * margin));
  const ht = displayFloat(Math.ceil(bottom));
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}" font-family="${FAMILY}" font-size="${FONT}" fill="#000">`,
    `<rect width="${w}" height="${ht}" fill="#fff"/>`,
    `<g transform="translate(${f(margin - r.minX)} 0)">`,
    ...lifelines,
    ...r.frames,
    ...r.bars,
    ...headSvgs,
    ...footSvgs,
    ...r.front,
    "</g>",
    "</svg>",
    "",
  ];
  return { svg: out.join("\n"), warnings: r.warnings };
}
