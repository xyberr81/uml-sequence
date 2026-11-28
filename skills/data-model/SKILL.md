---
name: data-model
description: Draw database schema (physical data model) diagrams as PNG, SVG, or HTML. Tables with column types and PK/FK keys, crow's-foot relations joining the rows they reference, and schema changes (new, deleted and retyped tables and columns). Use when asked to draw, redraw, or convert a data model, database schema, or migration (from a description, SQL, an ORM schema such as Drizzle or Prisma, Mermaid, PlantUML, or an image). Not for conceptual Chen-notation ER diagrams (entities, attribute ovals, relationship diamonds).
---

The diagram is written as a `.puml` source file and rendered to PNG by this skill's `src/cli.ts` (TypeScript run directly by Node 22.18+; rasterizes through `@resvg/resvg-js`). The renderer owns the style and layout. Each table is a grid of type, name, key (`PK`/`FK`) and note, in its own light colour. Tables run left to right, and relation lines turn only at right angles, meeting each table at the row they name. A new table or column carries a black `new` badge, a deleted one is dashed black and white, and a changed type reads `old → new`. The `.puml` is the editable artifact and stays readable as text where nothing can render it; change the look by editing `src/render.ts`, then run `test/gen-golden.sh` and review the golden diff, so every diagram stays consistent.

## Steps

1. **Write the source** as `<name>.puml` next to where the PNG should live, using only the syntax below. Declare every entity before the relations that name it, in the order you want them read: tables of a relation are placed left to right, and colours are picked by declaration order. Mark keys (`*` or `<<PK>>`, `<<FK>>`). When a relation joins specific columns, name them as `Entity::column` on both ends so the line meets those rows. For a schema change, mark what the change adds `<<new>>`, what it drops `<<deleted>>`, and write a retyped column as `old -> new`; leave untouched tables and columns unmarked. Put a column's purpose in a `// note` only when its name does not say it. Done when every table, column and relation is in the source, and every changed item carries its mark.
2. **Humanize the text**: invoke the `humanizer` skill in embedded mode on every piece of prose in the source (title, relation labels, column notes), then write its result back into the source. Keep code-like text unchanged: table, column and type names. Relation labels stay short verb phrases (`held by`, `borrows`), so humanizer should not turn them into sentences. Done when no label or note has a dash, a triad, a not-X-but-Y contrast, or a word from humanizer's AI-word list.
3. **Render**: `node ~/.claude/skills/data-model/src/cli.ts <name>.puml [out.png|out.svg|out.html]` (if `node_modules/` is missing, run `npm install` in `~/.claude/skills/data-model/` first) (output defaults to `<name>.png`; `.html` writes a standalone page; if that file already exists and isn't one you made, pick another path). Done when it prints the output path with **zero warnings**: each warning is a skipped or doubtful line (see Warnings below); fix the source and re-render.
4. **Look at it**: Read the PNG. Done when every table, column and relation is there, every label is legible and clear of lines and other text, and the `new`/deleted/`old → new` marks match the change. Fix problems in the source (declaration order, row ends), then re-render.
5. Report the `.puml` and `.png` paths.

## Syntax (PlantUML subset)

One statement per line; a line starting with `'` is a comment.

| Write | Draws |
|---|---|
| `title Library loans` | bold centered title |
| `entity Copy {` … `}` | table; `entity "Loan item" {` quotes a name with spaces |
| `entity Hold <<new>> {` … `}` | new table, with the `new` badge |
| `entity Reservation <<deleted>> {` … `}` | deleted table, dashed black and white |
| `entity Tag` / `entity Tag {}` | table with no columns |
| `* id : int` / `id : int <<PK>>` | primary key, `PK` in the key cell |
| `book_id : int <<FK>>` | foreign key, `FK` in the key cell |
| `book_id : int` / `book_id` | column, the type optional |
| `due : date // returned by then` | column with a note, after its marks |
| `on_loan : bool <<new>>` | new column, with the `new` badge |
| `shelf : text <<deleted>>` | deleted column, struck through |
| `due : date -> timestamptz` / `due : date → timestamptz` | type change, drawn `date → timestamptz` |
| `--` / `..` (inside an entity) | separator line between column groups |
| `Copy \|\|--o{ Hold : held by` | solid relation with an optional `: label` |
| `Hold }o..\|\| Reservation` | dashed relation |
| `Copy::id \|\|--o{ Hold::copy_id : held by` | relation joining those rows; either end may name one |

Each relation end is two characters. On the left, from `|`, `o` and `}`; on the right, from `|`, `o` and `{`. `|` means one, `o` allows zero, `}`/`{` means many: `||` exactly one, `|o`/`o|` zero or one, `}|`/`|{` one or more, `}o`/`o{` zero or more.

Marks on a column go after the type and before the note, in any order: `copy_id : int <<FK>> <<new>> // held back`. A row end is `Entity::column` with no spaces, the column name in word characters.

```
entity Copy {
  * id : int
  book_id : int <<FK>>
}
entity Hold <<new>> {
  * id : int
  copy_id : int <<FK>> // set when a copy is held back
}
Copy::id |o--o{ Hold::copy_id : set aside for
```

`@startuml`, `@enduml`, `hide …`, `show …`, `skinparam …` (including a `skinparam name {` … `}` block) and `left to right direction` / `top to bottom direction` are skipped quietly; the layout is fixed.

## Warnings

Each is printed as `warning: …`; the render still writes the picture and exits 0.

- `line N: unsupported, skipped: <line>`: a line outside the subset.
- `line N: relation names an undeclared entity, skipped: <line>`: declare the entity above the relation.
- `line N: <Entity> has no column <col>, the relation kept at table level: <line>`: the relation is drawn from the table's header; fix the column name.
- `line N: <Entity> joins row <col> to itself, which is likely a typo: <line>`: name the other column it joins.
- `line N: entity X declared twice, the first kept`: merge the two blocks.
- `unclosed entity X (missing "}")`: close the block.
