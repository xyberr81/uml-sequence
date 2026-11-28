// Parse the PlantUML sequence subset (see uml-sequence SKILL.md) into a Diagram.
// Unsupported lines are skipped with a warning, never a hard error.
import {
  asciiLower,
  findWhitespace,
  hasWhitespace,
  isAsciiAlnum,
  isAsciiDigit,
  isAsciiWhitespace,
  isWhitespace,
  sourceLines,
  splitLines,
  splitWhitespace,
  trim,
  trimEnd,
  trimStart,
} from "./text.ts";

// ---------------------------------------------------------------- model

export const KINDS = ["participant", "actor", "database", "queue", "boundary", "control", "entity", "collections"] as const;
export type PartKind = (typeof KINDS)[number];
/** Kinds drawn as a box with a «kind» stereotype line. */
export const STEREO: readonly PartKind[] = ["queue", "boundary", "control", "entity", "collections"];
const FRAG_KINDS = ["alt", "opt", "loop", "par", "break", "critical", "group"] as const;

export interface Part {
  id: string;
  name: string;
  kind: PartKind;
}

/** `++` activates the target at the arrow; `--` deactivates the source. */
export type ActMark = "++" | "--";

export interface Msg {
  type: "msg";
  from: number;
  to: number;
  dashed: boolean;
  filled: boolean;
  mark: ActMark | null;
  lines: string[];
  /** Autonumber value; bigint because Rust used i64. */
  num: bigint | null;
}

export type NotePos = "over" | "left" | "right";
export interface Note {
  type: "note";
  pos: NotePos;
  targets: number[];
  lines: string[];
}

export interface Section {
  guard: string;
  events: Ev[];
}
export interface Frag {
  type: "frag";
  /** Tab label: the fragment keyword, or a `group`'s custom label. */
  kind: string;
  sections: Section[];
}

export type Ev =
  | Msg
  | Note
  | Frag
  | { type: "divider"; lines: string[] }
  | { type: "delay"; lines: string[] }
  | { type: "space" }
  | { type: "activate"; part: number }
  | { type: "deactivate"; part: number };

export interface Diagram {
  parts: Part[];
  events: Ev[];
  title: string[] | null;
  footbox: boolean;
}

// ---------------------------------------------------------------- token helpers

const isWord = (c: string | undefined): boolean => c !== undefined && (isAsciiAlnum(c) || c === "_");
const startsWs = (s: string): boolean => s.length > 0 && isWhitespace(s[0]!);

function unq(s: string): string {
  const t = trim(s);
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

/** `word` at the start of `line`, ending on a word boundary; returns the rest. */
function kw(line: string, word: string): string | null {
  if (!line.startsWith(word)) return null;
  const rest = line.slice(word.length);
  return isWord(rest[0]) ? null : rest;
}

/** `word`, whitespace, then a non-empty rest. */
function kwWs(line: string, word: string): string | null {
  if (!line.startsWith(word)) return null;
  const rest = line.slice(word.length);
  if (!startsWs(rest)) return null;
  const r = trimStart(rest);
  return r === "" ? null : r;
}

/** Drop ` #color` tokens. */
function stripColors(s: string): string {
  const cs = Array.from(s);
  let out = "";
  let i = 0;
  while (i < cs.length) {
    if (isWhitespace(cs[i]!)) {
      let j = i;
      while (j < cs.length && isWhitespace(cs[j]!)) j++;
      if (j < cs.length && cs[j] === "#") {
        let k = j + 1;
        while (k < cs.length && isWord(cs[k])) k++;
        if (k > j + 1) {
          i = k;
          continue;
        }
      }
      out += cs.slice(i, j).join("");
      i = j;
      continue;
    }
    out += cs[i];
    i++;
  }
  return out;
}

/** Drop an `order N` clause from a declaration. */
function stripOrder(s: string): string {
  const toks = splitWhitespace(s);
  for (let w = 0; w < Math.max(toks.length - 1, 0); w++) {
    if (w > 0 && toks[w] === "order" && Array.from(toks[w + 1]!).every(isAsciiDigit)) {
      return [...toks.slice(0, w), ...toks.slice(w + 2)].join(" ");
    }
  }
  return s;
}

function afterAs(r: string): string | null {
  if (!startsWs(r)) return null;
  const t = trimStart(r);
  if (!t.startsWith("as")) return null;
  const u = t.slice(2);
  if (!startsWs(u)) return null;
  return trimStart(u);
}

function quotedWhole(s: string): string | null {
  return s.length >= 3 && s.startsWith('"') && s.endsWith('"') && !s.slice(1, -1).includes('"') ? s.slice(1, -1) : null;
}

/** Participant declaration body → display name and id. */
function parseDecl(s: string): { name: string; id: string } | null {
  if (s.startsWith('"')) {
    const body = s.slice(1);
    const j = body.indexOf('"');
    if (j > 0) {
      const id = afterAs(body.slice(j + 1));
      if (id !== null && id !== "" && !hasWhitespace(id)) return { name: body.slice(0, j), id };
    }
  }
  const ws = findWhitespace(s);
  const tokEnd = ws === -1 ? s.length : ws;
  const tok = s.slice(0, tokEnd);
  const r = afterAs(s.slice(tokEnd));
  if (r !== null) {
    const name = quotedWhole(r);
    if (name !== null) return { name, id: tok };
    if (r !== "" && !hasWhitespace(r)) return { name: tok, id: r };
  }
  const name = quotedWhole(s);
  if (name !== null) return { name, id: name };
  if (s !== "" && !hasWhitespace(s)) return { name: s, id: s };
  return null;
}

/** A participant reference (quoted or `[A-Za-z0-9_.]+`) and the rest of the line. */
function takeName(s: string): [string, string] | null {
  if (s.startsWith('"')) {
    const j = s.slice(1).indexOf('"');
    if (j <= 0) return null;
    return [s.slice(0, j + 2), s.slice(j + 2)];
  }
  let end = 0;
  while (end < s.length && (isWord(s[end]) || s[end] === ".")) end++;
  return end === 0 ? null : [s.slice(0, end), s.slice(end)];
}

/** Returns [arrow with any `[#color]` after its first dash removed, rest]. */
function takeArrow(s: string): [string, string] | null {
  let i = s[0] === "<" ? (s[1] === "<" ? 2 : 1) : 0;
  let arrow = s.slice(0, i);
  let d = 0;
  while (d < 2 && s[i] === "-") {
    i++;
    d++;
    arrow += "-";
    if (d === 1 && s[i] === "[") {
      const close = s.indexOf("]", i);
      if (close === -1) return null;
      i = close + 1;
    }
  }
  if (d === 0) return null;
  if (!arrow.startsWith("<")) {
    if (s[i] !== ">") return null;
    i++;
    arrow += ">";
    if (s[i] === ">") {
      i++;
      arrow += ">";
    }
  }
  return [arrow, s.slice(i)];
}

interface RawMsg {
  a: string;
  arrow: string;
  b: string;
  mark: ActMark | null;
  label: string | null;
}

function parseMsg(line: string): RawMsg | null {
  const na = takeName(line);
  if (!na) return null;
  const ar = takeArrow(trimStart(na[1]));
  if (!ar) return null;
  const nb = takeName(trimStart(ar[1]));
  if (!nb) return null;
  let r = trimStart(nb[1]);
  let mark: ActMark | null = null;
  if (r.startsWith("++")) mark = "++";
  else if (r.startsWith("--")) mark = "--";
  if (mark) r = r.slice(2);
  r = trimStart(r);
  let label: string | null = null;
  if (r !== "") {
    if (!r.startsWith(":")) return null;
    label = trimStart(r.slice(1));
  }
  return { a: na[0], arrow: ar[0], b: nb[0], mark, label };
}

interface RawNote {
  pos: NotePos;
  targets: string;
  text: string | null;
}

function parseNote(line: string): RawNote | null {
  const low = asciiLower(line);
  const skip = low.startsWith("hnote") || low.startsWith("rnote") ? 5 : low.startsWith("note") ? 4 : 0;
  if (skip === 0) return null;
  let r = line.slice(skip);
  if (!startsWs(r)) return null;
  r = trimStart(r);
  const lr = asciiLower(r);
  let pos: NotePos;
  let plen: number;
  if (lr.startsWith("over")) [pos, plen] = ["over", 4];
  else if (lr.startsWith("left of")) [pos, plen] = ["left", 7];
  else if (lr.startsWith("right of")) [pos, plen] = ["right", 8];
  else return null;
  r = r.slice(plen);
  if (!startsWs(r)) return null;
  r = trimStart(r);
  const j = r.indexOf(":");
  const [targets, text] = j === -1 ? [r, null] : [trimEnd(r.slice(0, j)), trimStart(r.slice(j + 1))];
  return targets === "" ? null : { pos, targets, text };
}

function isEndNote(line: string): boolean {
  const l = asciiLower(line);
  return l === "endnote" || (l.length === 8 && l.startsWith("end") && l.endsWith("note") && isAsciiWhitespace(l[3]!));
}

/** Rust `str::parse::<i64>`: optional sign, ASCII digits, in range. */
function parseI64(t: string): bigint | null {
  if (!/^[+-]?[0-9]+$/.test(t)) return null;
  const v = BigInt(t);
  return v >= -(2n ** 63n) && v < 2n ** 63n ? v : null;
}

// ---------------------------------------------------------------- parse

export interface ParseResult {
  diagram: Diagram;
  warnings: string[];
}

export function parse(src: string): ParseResult {
  const warnings: string[] = [];
  const parts: Part[] = [];
  const root: Ev[] = [];
  const open: Frag[] = [];
  let title: string[] | null = null;
  let num: bigint | null = null;
  let footbox = true;
  let note: Note | null = null;
  let skipBlock = false;

  const ensure = (id: string): number => {
    const i = parts.findIndex((p) => p.id === id);
    if (i !== -1) return i;
    parts.push({ id, name: id, kind: "participant" });
    return parts.length - 1;
  };
  const push = (e: Ev): void => {
    const fr = open[open.length - 1];
    if (fr) fr.sections[fr.sections.length - 1]!.events.push(e);
    else root.push(e);
  };

  lines: for (const [i, raw] of sourceLines(src).entries()) {
    const line = trim(raw);
    const ln = i + 1;
    if (note) {
      if (isEndNote(line)) {
        push(note);
        note = null;
      } else note.lines.push(line);
      continue lines;
    }
    if (skipBlock) {
      if (line === "}") skipBlock = false;
      continue lines;
    }
    if (line === "" || line.startsWith("'") || line.startsWith("!") || line.startsWith("@startuml") || line.startsWith("@enduml")) {
      continue lines;
    }
    if (kw(line, "skinparam") !== null) {
      skipBlock = line.endsWith("{");
      continue lines;
    }
    const words = splitWhitespace(asciiLower(line));
    if (words.length === 2 && words[0] === "hide" && words[1] === "footbox") {
      footbox = false;
      continue lines;
    }
    if (["hide", "show", "scale", "autoactivate"].some((w) => kw(line, w) !== null)) continue lines;
    const t = kwWs(line, "title");
    if (t !== null) {
      title = splitLines(t);
      continue lines;
    }
    if (line.startsWith("autonumber")) {
      const r = line.slice("autonumber".length);
      const tok = startsWs(r) ? splitWhitespace(r)[0] : undefined;
      if (tok === "stop") num = null;
      else if (tok === undefined) num = 1n;
      else {
        const v = parseI64(tok);
        num = v !== null && v !== 0n ? v : 1n;
      }
      continue lines;
    }
    for (const kind of KINDS) {
      const rest = kwWs(line, kind);
      if (rest === null) continue;
      const decl = parseDecl(trim(stripOrder(stripColors(rest))));
      if (decl) {
        const p = parts[ensure(decl.id)]!;
        p.name = decl.name;
        p.kind = kind;
      } else warnings.push(`line ${ln}: bad participant, skipped: ${line}`);
      continue lines;
    }
    if (line.length >= 4 && line.startsWith("==") && line.endsWith("==")) {
      push({ type: "divider", lines: splitLines(trim(line.slice(2, -2))) });
      continue lines;
    }
    if (line.startsWith("...")) {
      const r = trimStart(line.slice(3));
      const text = r === "" ? "" : r.endsWith("...") ? trimEnd(r.slice(0, -3)) : null;
      if (text !== null) {
        push({ type: "delay", lines: text === "" ? [] : splitLines(text) });
        continue lines;
      }
    }
    if (line.length >= 3 && line.startsWith("||") && line.endsWith("|") && Array.from(line.slice(2, -1)).every(isAsciiDigit)) {
      push({ type: "space" });
      continue lines;
    }
    for (const k of FRAG_KINDS) {
      const r = kw(line, k);
      if (r === null) continue;
      const rest = trimStart(r);
      const [kind, guard] = k === "group" ? [rest === "" ? "group" : rest, ""] : [k, rest];
      open.push({ type: "frag", kind, sections: [{ guard, events: [] }] });
      continue lines;
    }
    const elseRest = kw(line, "else");
    if (elseRest !== null) {
      const fr = open[open.length - 1];
      if (fr) fr.sections.push({ guard: trimStart(elseRest), events: [] });
      else warnings.push(`line ${ln}: else outside a fragment`);
      continue lines;
    }
    if (line === "end") {
      const fr = open.pop();
      if (fr) push(fr);
      else warnings.push(`line ${ln}: end without a fragment`);
      continue lines;
    }
    const rn = parseNote(line);
    if (rn) {
      const targets = rn.targets.split(",").map((s) => ensure(unq(s)));
      if (rn.text !== null) push({ type: "note", pos: rn.pos, targets, lines: splitLines(rn.text) });
      else note = { type: "note", pos: rn.pos, targets, lines: [] };
      continue lines;
    }
    for (const w of ["activate", "deactivate", "destroy"] as const) {
      const r = kwWs(line, w);
      if (r === null) continue;
      const part = ensure(unq(r));
      push(w === "activate" ? { type: "activate", part } : { type: "deactivate", part });
      continue lines;
    }
    const m = parseMsg(line);
    if (m) {
      let from = ensure(unq(m.a));
      let to = ensure(unq(m.b));
      if (m.arrow.startsWith("<")) [from, to] = [to, from];
      const dashed = m.arrow.includes("--");
      const filled = !(dashed || m.arrow.includes("<<") || m.arrow.includes(">>"));
      push({ type: "msg", from, to, dashed, filled, mark: m.mark, lines: splitLines(m.label ?? ""), num });
      if (num !== null) num = BigInt.asIntN(64, num + 1n);
      continue lines;
    }
    warnings.push(`line ${ln}: unsupported, skipped: ${line}`);
  }

  if (note) warnings.push('unclosed note (missing "end note")');
  if (open.length > 0) warnings.push(`${open.length} unclosed fragment(s) (missing "end")`);
  for (let fr = open.pop(); fr; fr = open.pop()) push(fr);
  return { diagram: { parts, events: root, title, footbox }, warnings };
}
