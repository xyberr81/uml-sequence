// SVG primitives: arrow heads, dash style, and text runs.
import { esc, f, textW } from "./text.ts";

export const FONT = 14;
export const FAMILY = "Helvetica, Arial, sans-serif";

/** A standalone page around `svg`, byte-identical to the Rust renderer's .html output. */
export function htmlPage(title: string, svg: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>body{margin:0;padding:24px;background:#fff}svg{display:block;max-width:100%;height:auto}</style>
</head>
<body>
<div style="overflow-x:auto">
${svg}</div>
</body>
</html>
`;
}

/** Arrow head with its tip at (tipX, y), pointing along `dir` (+1 right, -1 left). */
export function arrowHead(tipX: number, y: number, dir: number, filled: boolean): string {
  const bx = tipX - dir * 10.0;
  if (filled) {
    return `<polygon points="${f(tipX)},${f(y)} ${f(bx)},${f(y - 4.5)} ${f(bx)},${f(y + 4.5)}" fill="#000"/>`;
  }
  return `<polyline points="${f(bx)},${f(y - 5.0)} ${f(tipX)},${f(y)} ${f(bx)},${f(y + 5.0)}" fill="none" stroke="#000" stroke-width="1.2"/>`;
}

/** Stroke-dash attribute for a dashed line, or nothing. */
export function dashAttr(on: boolean): string {
  return on ? ' stroke-dasharray="6 4"' : "";
}

/** One run of text inside a `<text>`: optionally bold, optionally shifted by `dx`. */
export interface Seg {
  s: string;
  bold: boolean;
  dx: number;
}
export const seg = (s: string): Seg => ({ s, bold: false, dx: 0 });
export const bold = (s: string): Seg => ({ s, bold: true, dx: 0 });

export type Anchor = "start" | "middle" | "end";
export interface TextOpts {
  anchor: Anchor;
  size: number;
  /** White backing rect so lines passing behind never cut through glyphs. */
  bg: boolean;
  italic: boolean;
}
export const PLAIN: TextOpts = { anchor: "start", size: FONT, bg: false, italic: false };
export const MIDDLE: TextOpts = { ...PLAIN, anchor: "middle" };

export interface TextEl {
  svg: string;
  /** Horizontal extent covered by the text, for canvas sizing. */
  left: number;
  right: number;
}

/** A `<text>` element (plus optional backing rect) with its estimated horizontal extent. */
export function textEl(x0: number, y: number, segs: readonly Seg[], o: TextOpts): TextEl {
  const w = segs.reduce((acc, sg) => acc + textW(sg.s, o.size, sg.bold) + sg.dx, 0.0);
  const left = o.anchor === "middle" ? x0 - w / 2.0 : o.anchor === "end" ? x0 - w : x0;
  let out = "";
  if (o.bg) {
    out += `<rect x="${f(left - 3.0)}" y="${f(y - o.size * 0.85)}" width="${f(w + 6.0)}" height="${f(o.size * 1.1)}" fill="#fff"/>`;
  }
  let attrs = `x="${f(x0)}" y="${f(y)}"`;
  if (o.anchor !== "start") attrs += ` text-anchor="${o.anchor}"`;
  if (o.size !== FONT) attrs += ` font-size="${f(o.size)}"`;
  if (o.italic) attrs += ' font-style="italic"';
  const body = segs
    .map((sg) => {
      let a = "";
      if (sg.bold) a += ' font-weight="bold"';
      if (sg.dx !== 0.0) a += ` dx="${f(sg.dx)}"`;
      return a === "" ? esc(sg.s) : `<tspan${a}>${esc(sg.s)}</tspan>`;
    })
    .join("");
  out += `<text ${attrs}>${body}</text>`;
  return { svg: out, left, right: left + w };
}
