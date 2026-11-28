// Data-model diagrams: a PlantUML IE subset (entity blocks, columns, crow's-foot
// relations that may name the rows they join, <<new>>, <<deleted>>, <<PK>> and
// <<FK>> marks, `// note`s, `old → new` types).
// Unsupported lines are skipped with a warning, never a hard error.
import { sourceLines, trim } from "./text.ts";

/** What the change does to a table or column. */
export type Change = "kept" | "new" | "deleted";

/** `key` is a primary key (`*` or `<<PK>>`), `fk` a foreign key (`<<FK>>`); `note` is "" when none. */
export type Row =
  | { kind: "column"; name: string; type: string; key: boolean; fk: boolean; note: string; change: Change }
  | { kind: "separator" };

export interface Entity {
  name: string;
  change: Change;
  rows: Row[];
}

/** One end of a relation: at most one or many, and whether zero is allowed. */
export interface End {
  entity: number;
  /** The row this end joins, or null for the table as a whole. */
  column: string | null;
  many: boolean;
  optional: boolean;
}

export interface Relation {
  from: End;
  to: End;
  dashed: boolean;
  label: string;
}

export interface Model {
  title: string;
  entities: Entity[];
  relations: Relation[];
}

const MARK = /\s*<<\s*(new|deleted)\s*>>\s*$/;
const COLUMN_MARK = /\s*<<\s*(new|deleted|PK|FK)\s*>>\s*$/i;
const ENTITY = /^entity\s+("[^"]+"|[\w.]+)\s*(<<\s*(?:new|deleted)\s*>>)?\s*(\{)?\s*(\})?$/;
const RELATION = /^("[^"]+"|[\w.]+)(?:::(\w+))?\s+([|}o]{2})(--|\.\.)([|{o]{2})\s+("[^"]+"|[\w.]+)(?:::(\w+))?\s*(?::\s*(.*))?$/;
const IGNORED = /^(@startuml|@enduml|hide\b|show\b|skinparam\b|left to right direction|top to bottom direction)/;

const unquote = (s: string): string => (s.startsWith('"') ? s.slice(1, -1) : s);

/** Split a trailing `<<new>>` / `<<deleted>>` off `s`. */
function change(s: string): [string, Change] {
  const m = MARK.exec(s);
  return m ? [s.slice(0, m.index), m[1] as Change] : [s, "kept"];
}

function column(line: string): Row {
  if (line === "--" || line === "..") return { kind: "separator" };
  const slash = line.indexOf("//");
  const note = slash < 0 ? "" : trim(line.slice(slash + 2));
  let body = slash < 0 ? line : trim(line.slice(0, slash));
  let ch: Change = "kept";
  let pk = false;
  let fk = false;
  for (let m = COLUMN_MARK.exec(body); m; m = COLUMN_MARK.exec(body)) {
    const mark = m[1]!.toLowerCase();
    if (mark === "pk") pk = true;
    else if (mark === "fk") fk = true;
    else ch = mark as Change;
    body = body.slice(0, m.index);
  }
  const key = body.startsWith("*");
  const text = trim(key ? body.slice(1) : body);
  const colon = text.indexOf(":");
  const name = trim(colon < 0 ? text : text.slice(0, colon));
  const type = colon < 0 ? "" : trim(text.slice(colon + 1)).replace(/\s*(?:->|→)\s*/, " → ");
  return { kind: "column", name, type, key: key || pk, fk, note, change: ch };
}

function end(token: string, entity: number, column: string | null): End {
  return { entity, column, many: /[{}]/.test(token), optional: token.includes("o") };
}

export function parse(src: string): { model: Model; warnings: string[] } {
  const warnings: string[] = [];
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  const index = new Map<string, number>();
  let title = "";
  let open: Entity | null = null;
  let skinBlock = false;

  sourceLines(src).forEach((raw, i) => {
    const ln = i + 1;
    const line = trim(raw);
    if (line === "" || line.startsWith("'")) return;
    if (skinBlock) {
      if (line === "}") skinBlock = false;
      return;
    }
    if (open) {
      if (line === "}") open = null;
      else open.rows.push(column(line));
      return;
    }
    if (IGNORED.test(line)) {
      if (line.startsWith("skinparam") && line.endsWith("{")) skinBlock = true;
      return;
    }
    if (line.startsWith("title ")) {
      title = trim(line.slice(6));
      return;
    }
    const e = ENTITY.exec(line);
    if (e) {
      const name = unquote(e[1]!);
      const ent: Entity = { name, change: e[2] ? change(e[2])[1] : "kept", rows: [] };
      if (index.has(name)) warnings.push(`line ${ln}: entity ${name} declared twice, the first kept`);
      else {
        index.set(name, entities.length);
        entities.push(ent);
      }
      if (e[3] && !e[4]) open = ent;
      return;
    }
    const r = RELATION.exec(line);
    if (r) {
      const a = index.get(unquote(r[1]!));
      const b = index.get(unquote(r[6]!));
      if (a === undefined || b === undefined) {
        warnings.push(`line ${ln}: relation names an undeclared entity, skipped: ${line}`);
        return;
      }
      /** The named row when entity `e` has it; otherwise warn and join the table. */
      const row = (e: number, col: string | undefined): string | null => {
        if (col === undefined) return null;
        const ent = entities[e]!;
        if (ent.rows.some((x) => x.kind === "column" && x.name === col)) return col;
        warnings.push(`line ${ln}: ${ent.name} has no column ${col}, the relation kept at table level: ${line}`);
        return null;
      };
      const from = row(a, r[2]);
      const to = row(b, r[7]);
      if (a === b && from !== null && from === to) {
        warnings.push(`line ${ln}: ${entities[a]!.name} joins row ${from} to itself, which is likely a typo: ${line}`);
      }
      relations.push({
        from: end(r[3]!, a, from),
        to: end(r[5]!, b, to),
        dashed: r[4] === "..",
        label: trim(r[8] ?? ""),
      });
      return;
    }
    warnings.push(`line ${ln}: unsupported, skipped: ${line}`);
  });

  if (open) warnings.push(`unclosed entity ${(open as Entity).name} (missing "}")`);
  return { model: { title, entities, relations }, warnings };
}
