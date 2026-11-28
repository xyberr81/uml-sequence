// Text and number helpers.
// Each one reproduces the Rust std behaviour the original renderer relied on, so
// output stays byte-identical: Unicode `White_Space` trimming, `f64::round`
// (half away from zero), and Rust float `Display`.

// ---------------------------------------------------------------- whitespace

/** Rust `char::is_whitespace`: the Unicode White_Space property (JS `\s` differs). */
export function isWhitespace(c: string): boolean {
  const n = c.codePointAt(0);
  if (n === undefined) return false;
  return (
    (n >= 0x09 && n <= 0x0d) ||
    n === 0x20 ||
    n === 0x85 ||
    n === 0xa0 ||
    n === 0x1680 ||
    (n >= 0x2000 && n <= 0x200a) ||
    n === 0x2028 ||
    n === 0x2029 ||
    n === 0x202f ||
    n === 0x205f ||
    n === 0x3000
  );
}




/** Rust `str::trim_start`. All White_Space code points are in the BMP, so UTF-16 units suffice. */
export function trimStart(s: string): string {
  let i = 0;
  while (i < s.length && isWhitespace(s[i]!)) i++;
  return s.slice(i);
}

/** Rust `str::trim_end`. */
export function trimEnd(s: string): string {
  let j = s.length;
  while (j > 0 && isWhitespace(s[j - 1]!)) j--;
  return s.slice(0, j);
}

/** Rust `str::trim`. */
export function trim(s: string): string {
  return trimEnd(trimStart(s));
}





/** Rust `str::lines`: split on `\n`, drop one trailing `\r` per line, no final empty line. */
export function sourceLines(src: string): string[] {
  if (src === "") return [];
  const parts = src.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}


// ---------------------------------------------------------------- numbers



/** Rust `f64::round`: half away from zero (JS `Math.round` rounds half up). */
export function roundHalfAway(x: number): number {
  if (!Number.isFinite(x)) return x;
  const t = Math.trunc(x);
  const frac = x - t; // exact for doubles
  if (Math.abs(frac) >= 0.5) return t + Math.sign(x);
  return t === 0 ? 0 * Math.sign(x) : t;
}

/** Rust `Display` for f64: `1` not `1.0`, `inf`, `-inf`, `NaN`. */
export function displayFloat(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (n === Infinity) return "inf";
  if (n === -Infinity) return "-inf";
  if (Object.is(n, -0)) return "-0";
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return BigInt(n).toString();
  return String(n);
}

/** Coordinate formatting: one decimal at most, trailing `.0` dropped, `-0` folded to `0`. */
export function f(n: number): string {
  let r = roundHalfAway(n * 10) / 10;
  if (r === 0) r = 0;
  if (!Number.isFinite(r)) return displayFloat(r);
  if (r % 1 === 0) return BigInt(r).toString();
  return r.toFixed(1);
}

// ---------------------------------------------------------------- XML + width

/** Escape text content for SVG (`&`, `<`, `>` only; attributes never hold user text). */
export function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const NARROW = " il.,:;|!'`";
const SLIM = 'IJfjrt()[]{}-/\\"';
const WIDE = "mwMW@%";

/**
 * Width of one character in ems. A conservative estimate: overshooting only adds
 * whitespace, undershooting overlaps text.
 */
export function charW(c: string): number {
  if (NARROW.includes(c)) return 0.3;
  if (SLIM.includes(c)) return 0.4;
  if (WIDE.includes(c)) return 0.9;
  if (c >= "A" && c <= "Z") return 0.7;
  return 0.58;
}

/** Estimated rendered width of `s` in px at font `size`; bold is 10% wider. */
export function textW(s: string, size: number, bold: boolean): number {
  let w = 0;
  for (const c of s) w += charW(c);
  return w * size * (bold ? 1.1 : 1.0);
}
