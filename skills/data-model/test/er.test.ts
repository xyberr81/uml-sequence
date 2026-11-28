// The data-model diagram: each kept table a grid in its own light colour, new tables
// and columns with a "new" icon, deleted ones dashed black and white, changed types
// as old → new.
//
// The SVG marks each table with `data-entity="Name"` and each column row with
// `data-column="name"` (its band as `data-y` and `data-h`), and each relation line
// with `class="relation"`; tests read one table's or row's markup by slicing from
// its marker to the next one.
import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "node:fs";
import { parseEr, renderEr } from "../src/er.ts";

const MODEL = `@startuml
title Holds
' a comment
hide circle
skinparam linetype ortho
entity Copy {
  * id : int
  --
  book_id : int
  on_loan : bool <<new>>
  shelf : text <<deleted>>
  due : date → timestamptz
  returned : date -> timestamptz
}
entity Hold <<new>> {
  * id : int
  copy_id : int
}
entity Reservation <<deleted>> {
  * id : int
}
Copy ||--o{ Hold : held by
Hold }o..|| Reservation
@enduml
`;

const MARKERS = /data-entity="|data-column="|class="relation"|<\/svg>/g;

/** Markup from `marker` up to the next table, column or relation marker. */
function slice(svg: string, marker: string): string {
  const start = svg.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  MARKERS.lastIndex = start + marker.length;
  const next = MARKERS.exec(svg);
  return svg.slice(start, next ? next.index : svg.length);
}

/** Markup of one table, header to its last column row. */
function table(svg: string, name: string): string {
  const start = svg.indexOf(`data-entity="${name}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = svg.slice(start + 1);
  const end = rest.search(/data-entity="|class="relation"|<\/svg>/);
  return svg.slice(start, start + 1 + end);
}

const row = (svg: string, name: string): string => slice(svg, `data-column="${name}"`);

const fills = (markup: string): string[] => [...markup.matchAll(/fill="([^"]*)"/g)].map((m) => m[1]!.toLowerCase());
const PLAIN_FILLS = new Set(["none", "#fff", "#ffffff", "white", "#000", "#000000", "black"]);
const coloured = (markup: string): string[] => fills(markup).filter((c) => !PLAIN_FILLS.has(c));

describe("renderEr", () => {
  const { svg, warnings } = renderEr(MODEL);

  test("a well-formed model renders an svg with no warnings", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(warnings).toEqual([]);
    expect(svg).toContain(">Holds<");
  });

  test("a kept table has one muted fill colour", () => {
    const kept = coloured(table(svg, "Copy"));
    expect(kept.length).toBeGreaterThan(0);
    expect(new Set(kept).size).toBe(1);
  });

  test("a new table carries the new icon", () => {
    expect(table(svg, "Hold")).toContain('class="new-icon"');
    expect(table(svg, "Copy").split('class="new-icon"').length - 1).toBe(1);
  });

  test("a new column carries the new icon", () => {
    expect(row(svg, "on_loan")).toContain('class="new-icon"');
    expect(row(svg, "book_id")).not.toContain('class="new-icon"');
  });

  test("a deleted table is dashed black and white, with no colour fill", () => {
    const t = table(svg, "Reservation");
    expect(t).toContain("stroke-dasharray");
    expect(coloured(t)).toEqual([]);
  });

  test("a deleted column is dashed, with no colour fill", () => {
    const r = row(svg, "shelf");
    expect(r).toContain("stroke-dasharray");
    expect(coloured(r)).toEqual([]);
    expect(row(svg, "book_id")).not.toContain("stroke-dasharray");
  });

  test("a changed type shows old → new, from either arrow", () => {
    expect(row(svg, "due")).toContain("date → timestamptz");
    expect(row(svg, "returned")).toContain("date → timestamptz");
  });

  test("each relation draws a path, labelled when it has a label", () => {
    const relations = svg.split('class="relation"').slice(1);
    expect(relations.length).toBe(2);
    for (const r of relations) expect(r.split(/data-entity="|class="relation"/)[0]).toContain("<path");
    expect(svg).toContain(">held by<");
  });

  test("an unknown line is a warning naming the line", () => {
    const r = renderEr("entity A {\n  id : int\n}\nfrobnicate A\n");
    expect(r.warnings).toEqual(["line 4: unsupported, skipped: frobnicate A"]);
    expect(r.svg).toContain('data-entity="A"');
  });
});

describe("parseEr keys, notes and row ends", () => {
  const KEYED = `@startuml
entity Copy {
  * id : int // the copy's own id
  isbn : text <<PK>>
  book_id : int <<FK>> // the book it copies
  on_loan : bool <<new>> <<FK>>
  shelf : text <<FK>> <<deleted>>
  title : text
}
entity "Loan item" {
  * id : int
  copy_id : int <<FK>>
}
Copy::id ||--o{ "Loan item"::copy_id : lent as
Copy ||--o{ "Loan item"::copy_id
"Loan item"::id }o--|| Copy
@enduml
`;
  const { model, warnings } = parseEr(KEYED);
  const col = (entity: number, name: string) => {
    const r = model.entities[entity]!.rows.find((x) => x.kind === "column" && x.name === name);
    expect(r).toBeDefined();
    return r as Extract<typeof r, { kind: "column" }>;
  };

  test("the keyed model parses with no warnings", () => {
    expect(warnings).toEqual([]);
  });

  test("a * column and a <<PK>> column are primary keys", () => {
    expect(col(0, "id")).toMatchObject({ key: true, fk: false, type: "int" });
    expect(col(0, "isbn")).toMatchObject({ key: true, fk: false, type: "text", change: "kept" });
    expect(col(0, "title")).toMatchObject({ key: false, fk: false });
  });

  test("a <<FK>> column is a foreign key, beside <<new>> or <<deleted>> in either order", () => {
    expect(col(0, "book_id")).toMatchObject({ key: false, fk: true, type: "int" });
    expect(col(0, "on_loan")).toMatchObject({ fk: true, change: "new", type: "bool" });
    expect(col(0, "shelf")).toMatchObject({ fk: true, change: "deleted", type: "text" });
  });

  test("a trailing // note is the column's note, and a column without one has none", () => {
    expect(col(0, "id")).toMatchObject({ note: "the copy's own id", type: "int" });
    expect(col(0, "book_id")).toMatchObject({ note: "the book it copies", type: "int" });
    expect(col(0, "title").note).toBe("");
  });

  test("a relation names the row on either or both ends, quoted names included", () => {
    expect(model.relations.map((r) => [r.from.entity, r.from.column, r.to.entity, r.to.column, r.label])).toEqual([
      [0, "id", 1, "copy_id", "lent as"],
      [0, null, 1, "copy_id", ""],
      [1, "id", 0, null, ""],
    ]);
    expect(model.relations[0]).toMatchObject({ from: { many: false, optional: false }, to: { many: true, optional: true } });
  });

  test("an end naming a column its table lacks keeps the relation at table level, with a warning", () => {
    const r = parseEr("entity A {\n  * id : int\n}\nentity B {\n  a_id : int\n}\nA::id ||--o{ B::nope : has\n");
    expect(r.warnings).toEqual(["line 7: B has no column nope, the relation kept at table level: A::id ||--o{ B::nope : has"]);
    expect(r.model.relations.map((x) => [x.from.column, x.to.column, x.label])).toEqual([["id", null, "has"]]);
  });

  test("a relation from a row to that same row is drawn with a warning naming the line", () => {
    const src = "entity B {\n  * id : int\n  parent_id : int\n}\n";
    const same = parseEr(src + "B::id |o--o{ B::id\n");
    expect(same.warnings).toEqual(["line 5: B joins row id to itself, which is likely a typo: B::id |o--o{ B::id"]);
    expect(same.model.relations).toHaveLength(1);
    expect(parseEr(src + "B::id |o--o{ B::parent_id\n").warnings).toEqual([]);
  });
});

// Geometry read back from the SVG: entity boxes are each table's first <rect>,
// a relation's label box is the white <rect> behind its text, and its line is
// the <path>, sampled into straight pieces (curves at 16 points each).
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
type P = [number, number];

const num = (s: string, name: string): number => Number(new RegExp(`\\b${name}="([^"]*)"`).exec(s)![1]);
const rectBox = (tag: string): Box => ({ x: num(tag, "x"), y: num(tag, "y"), w: num(tag, "width"), h: num(tag, "height") });

function pathPoints(d: string): P[] {
  const pts: P[] = [];
  let cur: P = [0, 0];
  for (const [, cmd, args] of d.matchAll(/([MLVHC])([^MLVHC]*)/g)) {
    const n = args!.trim().split(/[\s,]+/).map(Number);
    if (cmd === "M" || cmd === "L") cur = [n[0]!, n[1]!];
    else if (cmd === "V") cur = [cur[0], n[0]!];
    else if (cmd === "H") cur = [n[0]!, cur[1]];
    else {
      const [a, b, c] = [[n[0]!, n[1]!], [n[2]!, n[3]!], [n[4]!, n[5]!]] as P[];
      const s = cur;
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const u = 1 - t;
        const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
        pts.push([k[0]! * s[0] + k[1]! * a![0] + k[2]! * b![0] + k[3]! * c![0], k[0]! * s[1] + k[1]! * a![1] + k[2]! * b![1] + k[3]! * c![1]]);
      }
      cur = c!;
      continue;
    }
    pts.push(cur);
  }
  return pts;
}

function geometry(svg: string): { entities: { name: string; box: Box }[]; relations: { label: Box | null; line: P[] }[] } {
  const entities = [...svg.matchAll(/<g data-entity="([^"]*)"><rect [^>]*>/g)].map((m) => ({ name: m[1]!, box: rectBox(m[0]) }));
  const relations = svg
    .split('<g class="relation">')
    .slice(1)
    .map((g) => {
      const body = g.split(/data-entity="|<g class="relation">/)[0]!;
      const label = /<rect [^>]*fill="#fff"\/>/.exec(body);
      return { label: label ? rectBox(label[0]) : null, line: pathPoints(/<path d="([^"]*)"/.exec(body)![1]!) };
    });
  return { entities, relations };
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function segCross(p: P, q: P, r: P, s: P): boolean {
  const o = (a: P, b: P, c: P): number => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0;
}

function segHitsBox(p: P, q: P, b: Box): boolean {
  const inside = (a: P): boolean => a[0] > b.x && a[0] < b.x + b.w && a[1] > b.y && a[1] < b.y + b.h;
  if (inside(p) || inside(q)) return true;
  const c: P[] = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  return c.some((a, i) => segCross(p, q, a, c[(i + 1) % 4]!));
}

const pieces = (line: P[]): [P, P][] => line.slice(1).map((q, i) => [line[i]!, q]);

/** Every way a relation label is hard to read: on a box, on another label, or under another relation's line. */
function labelClashes(svg: string): string[] {
  const { entities, relations } = geometry(svg);
  const out: string[] = [];
  relations.forEach((r, i) => {
    if (!r.label) return;
    for (const e of entities) if (overlaps(r.label, e.box)) out.push(`label ${i} on ${e.name}`);
    relations.forEach((o, j) => {
      if (j === i) return;
      if (o.label && j > i && overlaps(r.label!, o.label)) out.push(`label ${i} on label ${j}`);
      if (pieces(o.line).some(([p, q]) => segHitsBox(p, q, r.label!))) out.push(`label ${i} under line ${j}`);
    });
  });
  return out;
}

function lineCrossings(svg: string): string[] {
  const { relations } = geometry(svg);
  const out: string[] = [];
  for (let i = 0; i < relations.length; i++) {
    for (let j = i + 1; j < relations.length; j++) {
      const a = pieces(relations[i]!.line);
      const b = pieces(relations[j]!.line);
      if (a.some(([p, q]) => b.some(([r, s]) => segCross(p, q, r, s)))) out.push(`line ${i} crosses line ${j}`);
    }
  }
  return out;
}

const FAN = `@startuml
entity Order {
  * id : int
}
entity Line {
  * id : int
}
entity Payment {
  * id : int
}
entity Shipment {
  * id : int
}
entity Refund {
  * id : int
}
Order ||--o{ Line : contains
Order ||--o{ Payment : paid by
Order ||--o{ Shipment : shipped as
Order ||--o{ Refund : refunded by
Payment ||--o{ Refund : returns
@enduml
`;

describe("renderEr legibility", () => {
  const example = readFileSync(new URL("fixtures/model.puml", import.meta.url), "utf8");
  const { svg } = renderEr(example);

  test("the example model's relation labels clear every box, label and other line", () => {
    expect(geometry(svg).relations.filter((r) => r.label).length).toBe(4);
    expect(labelClashes(svg)).toEqual([]);
  });

  test("the example model's relation lines do not cross", () => {
    expect(lineCrossings(svg)).toEqual([]);
  });

  test("one table with several labelled relations to tables on one layer keeps its labels clear", () => {
    const out = renderEr(FAN).svg;
    expect(geometry(out).relations.filter((r) => r.label).length).toBe(5);
    expect(labelClashes(out)).toEqual([]);
  });
});

// Modelled on reference-schema.png: tables joined at the rows each relation names.
const SCHEMA = `@startuml
entity permissions {
  * id : integer
  name : varchar
  description : varchar
}
entity roles {
  * id : integer
  name : varchar
  description : varchar
}
entity role_permissions {
  role_id : integer <<FK>>
  permission_id : integer <<FK>>
}
entity profiles {
  * id : integer
  clerk_id : varchar
  full_name : varchar
  phone_number : varchar_array
  role_id : integer <<FK>>
  created_at : timestamp
  updated_at : timestamp
  last_login_at : timestamp
}
entity notifications {
  * id : integer
  sender_id : integer <<FK>>
  receiver_id : integer <<FK>>
  message : varchar
  is_read : boolean
  link : varchar // opens the page it is about
  time_sent : timestamp
}
permissions::id ||--|{ role_permissions::permission_id : belongs_to
roles::id ||--|{ role_permissions::role_id : has
roles::id ||--o{ profiles::role_id : assigned_to
profiles::id ||--o{ notifications::sender_id : sends
profiles::id ||--o{ notifications::receiver_id : receives
profiles ||--o{ notifications : audits
@enduml
`;

/** A row's band [top, bottom] from its data-y and data-h. */
function band(svg: string, name: string): [number, number] {
  const r = row(svg, name);
  const y = /data-y="([^"]*)"/.exec(r);
  const h = /data-h="([^"]*)"/.exec(r);
  expect(y).not.toBeNull();
  expect(h).not.toBeNull();
  return [Number(y![1]), Number(y![1]) + Number(h![1])];
}

describe("renderEr grids joined at their rows", () => {
  const { svg, warnings } = renderEr(SCHEMA);
  const { model } = parseEr(SCHEMA);
  const { entities, relations } = geometry(svg);
  const boxOf = (i: number): Box => entities.find((e) => e.name === model.entities[i]!.name)!.box;
  /** Rows by table, so a row band is read from its own table's markup. */
  const bandIn = (t: number, col: string | null): [number, number] => {
    const markup = table(svg, model.entities[t]!.name);
    const b = boxOf(t);
    const firstRow = Number(/data-y="([^"]*)"/.exec(markup)![1]);
    return col === null ? [b.y, firstRow] : band(markup, col);
  };

  test("the schema renders with no warnings", () => {
    expect(warnings).toEqual([]);
    expect(relations.length).toBe(model.relations.length);
  });

  test("layers run left to right: the two tables of a relation sit side by side", () => {
    for (const r of model.relations) {
      const [a, b] = [boxOf(r.from.entity), boxOf(r.to.entity)];
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x).toBe(true);
    }
  });

  test("each relation end meets its table on the side facing the other, within its row's band (the header for a table-level end)", () => {
    model.relations.forEach((r, k) => {
      const line = relations[k]!.line;
      const ends = [line[0]!, line[line.length - 1]!];
      const meets = (end: typeof r.from, other: number, p: P): boolean => {
        const b = boxOf(end.entity);
        const o = boxOf(other);
        const sideX = o.x > b.x ? b.x + b.w : b.x;
        const [lo, hi] = bandIn(end.entity, end.column);
        return Math.abs(p[0] - sideX) < 1 && p[1] > lo && p[1] < hi;
      };
      const ok =
        (meets(r.from, r.to.entity, ends[0]!) && meets(r.to, r.from.entity, ends[1]!)) ||
        (meets(r.from, r.to.entity, ends[1]!) && meets(r.to, r.from.entity, ends[0]!));
      expect({ relation: r.label, ok }).toEqual({ relation: r.label, ok: true });
    });
  });

  test("each kept table has its own colour", () => {
    const colours = model.entities.map((e) => {
      const c = coloured(table(svg, e.name));
      expect(new Set(c).size).toBe(1);
      return c[0];
    });
    expect(new Set(colours).size).toBe(model.entities.length);
  });

  test("a new table differs in colour from a kept one", () => {
    const { svg: holds } = renderEr(MODEL);
    expect(coloured(table(holds, "Hold"))[0]).not.toBe(coloured(table(holds, "Copy"))[0]);
  });

  test("a row's cells say its type, name and key, with the note when it has one", () => {
    for (const s of [">integer<", ">id<", ">PK<"]) expect(row(table(svg, "permissions"), "id")).toContain(s);
    expect(row(table(svg, "profiles"), "role_id")).toContain(">FK<");
    expect(row(table(svg, "notifications"), "link")).toContain(">opens the page it is about<");
    expect(row(table(svg, "profiles"), "clerk_id")).not.toMatch(/>(PK|FK)</);
  });

  test("the schema's relation labels clear every box, label and other line", () => {
    expect(labelClashes(svg)).toEqual([]);
  });

  test("a self-relation joins its two rows on the table's right side", () => {
    const self = `@startuml
entity locations {
  * id : integer
  name : varchar
  parent_id : integer <<FK>>
}
locations::id |o--o{ locations::parent_id : parent_of
@enduml
`;
    const out = renderEr(self).svg;
    const g = geometry(out);
    const b = g.entities[0]!.box;
    const line = g.relations[0]!.line;
    const ends = [line[0]!, line[line.length - 1]!];
    const bands = [band(out, "id"), band(out, "parent_id")];
    for (const [k, p] of ends.entries()) {
      expect(Math.abs(p[0] - (b.x + b.w))).toBeLessThan(1);
      expect(p[1] > bands[k]![0] && p[1] < bands[k]![1]).toBe(true);
    }
  });
});

// Every relation joined at its rows: Copy's and Member's id rows each carry two
// ends on one side, and the row ends pull lines across each other unless the
// layout counts crossings between the rows lines meet.
const ROW_JOINED = `@startuml
title Holds on loaned books

entity Member {
  * id : int
  name : text
  email : text
}

entity Book {
  * id : int
  title : text
}

entity Copy {
  * id : int
  book_id : int <<FK>>
  branch : text
}

entity Loan {
  * id : int
  copy_id : int <<FK>>
  member_id : int <<FK>>
  due : date
}

entity Hold <<new>> {
  * id : int
  book_id : int <<FK>>
  member_id : int <<FK>>
  copy_id : int <<FK>> // set when a copy is held back
  --
  state : text // waiting, ready or done
  created_at : timestamptz
  ready_at : timestamptz
}

Book::id ||--o{ Copy::book_id : has
Copy::id ||--o{ Loan::copy_id
Member::id ||--o{ Loan::member_id : borrows
Book::id ||--o{ Hold::book_id : held by
Member::id ||--o{ Hold::member_id
Copy::id |o--o{ Hold::copy_id : set aside for
@enduml
`;

/**
 * Each relation end as its point and the half-height of its marks, read from the
 * path's `data-marks="startHalf tipHalf"` (7 when absent), keyed by the table and
 * side it meets.
 */
function endMarks(svg: string): Map<string, { y: number; half: number }[]> {
  const { entities } = geometry(svg);
  const out = new Map<string, { y: number; half: number }[]>();
  for (const g of svg.split('<g class="relation">').slice(1)) {
    const tag = /<path [^>]*>/.exec(g)![0];
    const halves = (/data-marks="([^"]*)"/.exec(tag)?.[1] ?? "7 7").split(" ").map(Number);
    const line = pathPoints(/ d="([^"]*)"/.exec(tag)![1]!);
    [line[0]!, line[line.length - 1]!].forEach((p, i) => {
      for (const e of entities) {
        const side = Math.abs(p[0] - e.box.x) < 1 ? "left" : Math.abs(p[0] - (e.box.x + e.box.w)) < 1 ? "right" : null;
        if (side === null || p[1] < e.box.y || p[1] > e.box.y + e.box.h) continue;
        const key = `${e.name} ${side}`;
        out.set(key, [...(out.get(key) ?? []), { y: p[1], half: halves[i]! }]);
      }
    });
  }
  return out;
}

describe("renderEr row-joined lines", () => {
  const { svg, warnings } = renderEr(ROW_JOINED);

  test("the row-joined example renders with no warnings", () => {
    expect(warnings).toEqual([]);
  });

  test("the row-joined example's relation lines do not cross", () => {
    expect(lineCrossings(svg)).toEqual([]);
  });

  test("no two end marks on one table side come within a mark's height of each other", () => {
    const clashes: string[] = [];
    for (const [side, ends] of endMarks(svg))
      ends.forEach((a, i) =>
        ends.slice(i + 1).forEach((b) => {
          if (Math.abs(a.y - b.y) < a.half + b.half) clashes.push(`${side}: ${a.y} and ${b.y}`);
        }),
      );
    expect(clashes).toEqual([]);
  });

  test("the row-joined example's relation labels clear every box, label and other line", () => {
    expect(labelClashes(svg)).toEqual([]);
  });
});

// Relation lines turn at sharp corners: each runs out of its row, along its own
// vertical channel in a gap between layers, and into the other row.
const SELF = `@startuml
entity locations {
  * id : integer
  name : varchar
  parent_id : integer <<FK>>
}
locations::id |o--o{ locations::parent_id : parent_of
@enduml
`;

/** A relation path's vertical runs, V or a vertical L, as x and the y range they span. */
function verticals(d: string): { x: number; lo: number; hi: number }[] {
  const out: { x: number; lo: number; hi: number }[] = [];
  let cur: P = [0, 0];
  for (const [, cmd, args] of d.matchAll(/([MLVH])([^MLVH]*)/g)) {
    const n = args!.trim().split(/[\s,]+/).map(Number);
    const next: P = cmd === "V" ? [cur[0], n[0]!] : cmd === "H" ? [n[0]!, cur[1]] : [n[0]!, n[1]!];
    if (cmd !== "M" && next[0] === cur[0] && next[1] !== cur[1]) out.push({ x: cur[0], lo: Math.min(cur[1], next[1]), hi: Math.max(cur[1], next[1]) });
    cur = next;
  }
  return out;
}

const paths = (svg: string): string[] => svg.split('<g class="relation">').slice(1).map((g) => / d="([^"]*)"/.exec(/<path [^>]*>/.exec(g)![0])![1]!);

describe("renderEr sharp corners", () => {
  const example = readFileSync(new URL("fixtures/model.puml", import.meta.url), "utf8");
  const models: [string, string][] = [
    ["holds", MODEL],
    ["example", example],
    ["fan", FAN],
    ["schema", SCHEMA],
    ["row-joined", ROW_JOINED],
    ["self", SELF],
  ];

  test("every relation path is straight horizontal and vertical runs only", () => {
    for (const [name, src] of models) {
      for (const d of paths(renderEr(src).svg)) {
        expect({ name, d, ok: /^[MLHV0-9.\s,-]+$/.test(d) }).toEqual({ name, d, ok: true });
        let cur: P = [0, 0];
        for (const [, cmd, args] of d.matchAll(/([MLVH])([^MLVH]*)/g)) {
          const n = args!.trim().split(/[\s,]+/).map(Number);
          if (cmd === "L") expect({ name, d, axis: n[0] === cur[0] || n[1] === cur[1] }).toEqual({ name, d, axis: true });
          cur = cmd === "V" ? [cur[0], n[0]!] : cmd === "H" ? [n[0]!, cur[1]] : [n[0]!, n[1]!];
        }
      }
    }
  });

  test("no two relations run vertically along the same x where their spans overlap", () => {
    for (const [name, src] of models) {
      const runs = paths(renderEr(src).svg).map(verticals);
      const clashes: string[] = [];
      runs.forEach((a, i) =>
        runs.slice(i + 1).forEach((b, k) => {
          for (const p of a) for (const q of b) if (Math.abs(p.x - q.x) < 1 && Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo) > 0) clashes.push(`line ${i} and line ${i + k + 1} at x ${p.x}`);
        }),
      );
      expect({ name, clashes }).toEqual({ name, clashes: [] });
    }
  });

  test("no relation line runs through a table", () => {
    for (const [name, src] of models) {
      const { entities, relations } = geometry(renderEr(src).svg);
      const through: string[] = [];
      relations.forEach((r, i) => {
        for (const e of entities) {
          // Ends meet a table on its edge, so only a line inside it, past rounding, runs through.
          const inner = { x: e.box.x + 1, y: e.box.y + 1, w: e.box.w - 2, h: e.box.h - 2 };
          if (pieces(r.line).some(([p, q]) => segHitsBox(p, q, inner))) through.push(`line ${i} through ${e.name}`);
        }
      });
      expect({ name, through }).toEqual({ name, through: [] });
    }
  });

  test("the self-relation is a rectangular loop off the table's side", () => {
    const d = paths(renderEr(SELF).svg)[0]!;
    expect(d).toMatch(/^M[^MLHVC]+H[^MLHVC]+V[^MLHVC]+H[^MLHVC]+$/);
  });
});

// A self-relation whose row also carries another relation out of the same side:
// locations has one end on each side, so its loop goes right, from the id row the
// hosts relation also leaves.
const SELF_SHARED = `@startuml
entity regions {
  * id : integer
}
entity locations {
  * id : integer
  region_id : integer <<FK>>
  name : varchar
  parent_id : integer <<FK>>
}
entity sites {
  * id : integer
  location_id : integer <<FK>>
}
regions::id ||--o{ locations::region_id : contains
locations::id ||--o{ sites::location_id : hosts
locations::id |o--o{ locations::parent_id : parent_of
@enduml
`;

/** Closest two vertical runs of different relations may come, so each reads as its own channel. */
const CHANNEL_GAP = 4;

describe("renderEr self-relation sharing a row", () => {
  const { svg, warnings } = renderEr(SELF_SHARED);
  const ends = endMarks(svg);

  test("the model renders with no warnings, the loop and hosts both leaving locations' right side", () => {
    expect(warnings).toEqual([]);
    expect(ends.get("locations right")?.length).toBe(3);
  });

  test("no two end marks on one table side come within a mark's height of each other", () => {
    const clashes: string[] = [];
    for (const [side, es] of ends)
      es.forEach((a, i) =>
        es.slice(i + 1).forEach((b) => {
          if (Math.abs(a.y - b.y) < a.half + b.half) clashes.push(`${side}: ${a.y} and ${b.y}`);
        }),
      );
    expect(clashes).toEqual([]);
  });

  test("each loop end stays within its row's band", () => {
    const d = paths(svg).find((p) => p.includes("V") && pathPoints(p)[0]![0] === pathPoints(p).at(-1)![0])!;
    const pts = pathPoints(d);
    const locations = table(svg, "locations");
    const [id, parent] = [band(locations, "id"), band(locations, "parent_id")];
    expect(pts[0]![1] > id[0] && pts[0]![1] < id[1]).toBe(true);
    expect(pts.at(-1)![1] > parent[0] && pts.at(-1)![1] < parent[1]).toBe(true);
  });

  test("labels clear every box, label and other line, and no lines cross", () => {
    expect(labelClashes(svg)).toEqual([]);
    expect(lineCrossings(svg)).toEqual([]);
  });

  test("paths are axis-aligned runs and no two share a vertical channel", () => {
    const ds = paths(svg);
    for (const d of ds) {
      expect({ d, ok: /^[MLHV0-9.\s,-]+$/.test(d) }).toEqual({ d, ok: true });
      let cur: P = [0, 0];
      for (const [, cmd, args] of d.matchAll(/([MLVH])([^MLVH]*)/g)) {
        const n = args!.trim().split(/[\s,]+/).map(Number);
        if (cmd === "L") expect({ d, axis: n[0] === cur[0] || n[1] === cur[1] }).toEqual({ d, axis: true });
        cur = cmd === "V" ? [cur[0], n[0]!] : cmd === "H" ? [n[0]!, cur[1]] : [n[0]!, n[1]!];
      }
    }
    const runs = ds.map(verticals);
    const shared: string[] = [];
    runs.forEach((a, i) =>
      runs.slice(i + 1).forEach((b, k) => {
        for (const p of a) for (const q of b) if (Math.abs(p.x - q.x) < CHANNEL_GAP) shared.push(`line ${i} and line ${i + k + 1} at x ${p.x} and ${q.x}`);
      }),
    );
    expect(shared).toEqual([]);
  });
});
