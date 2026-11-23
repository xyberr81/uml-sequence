---
name: uml-sequence
description: Draw black-and-white UML sequence diagrams as PNG, SVG, or HTML. Use when asked to draw, redraw, or convert a sequence diagram (from a description, code flow, Mermaid, PlantUML, or an image).
---

The diagram is written as a `.puml` source file and rendered to PNG by this skill's `src/cli.ts` (TypeScript run directly by Node 22.18+; rasterizes through `@resvg/resvg-js`). The renderer owns the style: dashed lifelines, paper-backed labels, columns widened until every label fits. Everything is black on white in Helvetica. The `.puml` is the editable artifact; change the look by editing `src/render.ts`, then run `test/gen-golden.sh` and review the golden diff, so every diagram stays consistent.

## Steps

1. **Write the source** as `<name>.puml` next to where the PNG should live, using only the syntax below. Declare every participant at the top, before any message or note, in layer order from left to right: the caller (actor, then UI), then APIs and services in the order calls reach them, then workers and external systems, then stores (databases, caches, object stores, queues) on the right. Columns follow the order participants first appear, so one that is declared late or never declared lands wherever the flow first touches it. A queue that triggers the flow goes on the far left. Keep each label line under ~45 characters — break longer ones with `\n`; fragment guards (`alt`, `else`, `loop` …) do not take `\n`, so keep them to one short line and move detail into a `note`. Put text a user sees on screen (a button, toggle, tab, menu item, page or message) in double quotes, with the kind of control after it: `"Send failed" toggle`, `"Retry send" button`, `"Sending is paused" alert`. Unquoted, `Send failed toggle` reads as a sentence. Give each separate flow (a run of messages started by its own trigger: a user action, a poll, a scheduler tick, a queue delivery) its own space. If the flows share few participants or the diagram would pass ~25 messages, write one `.puml` per flow. Otherwise start each flow with a `== Flow name ==` divider, which the renderer draws after a wide gap. Done when every message, fragment, and note is in the source in order, and no two flows run together without a divider.
2. **Humanize the text**: invoke the `humanizer` skill in embedded mode on every piece of prose in the source (title, message labels, notes, divider labels, fragment guards, delay text), then write its result back into the source. Keep code-like text unchanged: endpoints, identifiers, error codes, field names. Labels stay short verb phrases, which is normal for sequence diagrams, so humanizer should not turn them into full sentences. Done when no label has a dash, a triad, a not-X-but-Y contrast, or a word from humanizer's AI-word list.
3. **Render**: `node ~/.claude/skills/uml-sequence/src/cli.ts <name>.puml [out.png|out.svg|out.html]` (if `node_modules/` is missing, run `npm install` in `~/.claude/skills/uml-sequence/` first) (output defaults to `<name>.png`; `.html` writes a standalone page; if that file already exists and isn't one you made, pick another path). Done when it prints the output path with **zero warnings** — each warning is a skipped line; fix the source and re-render.
4. **Look at it**: Read the PNG. Done when every label is legible and clear of other text, and the flow matches the source. Fix problems in the source (line breaks, participant order), then re-render.
5. Report the `.puml` and `.png` paths.

## Syntax (PlantUML subset)

One statement per line; a line starting with `'` is a comment (no trailing comments — `'` inside a label is literal text).

| Write | Draws |
|---|---|
| `title Login flow` | bold centered title |
| `autonumber` / `autonumber 5` / `autonumber stop` | bold `1.` `2.` … prefixes on messages |
| `hide footbox` | no participant boxes at the bottom |
| `participant "Web App" as Web` | box |
| `actor User` | stick figure |
| `database "Postgres" as DB` | cylinder |
| `queue "Send queue (SQS)" as SQS` | box with «queue»; also `boundary`, `control`, `entity`, `collections` |
| `Web -> API : call` | sync: solid line, filled head |
| `API --> Web : reply` | reply: dashed line, open head |
| `Web ->> API : event` | async: solid line, open head |
| `Web <- API : x` | reversed arrows work for all of the above |
| `API -> API : step` | self message |
| `Web -> API ++ : call` / `API --> Web -- : reply` | activate target / deactivate source |
| `activate API` / `deactivate API` | activation bar starting/ending at the previous message |
| `== Phase ==` | full-width divider |
| `... 15 minutes later ...` / `...` | delay |
| `\|\|\|` | extra vertical space |
| `alt cond` … `else cond` … `end` | fragment; also `opt`, `loop`, `par`, `break`, `critical`; nest freely |
| `group Label` … `end` | fragment with a custom tab label |
| `note over A : text` | note; also `note over A, B`, `note left of A`, `note right of A` |
| `note over A` … `end note` | multi-line note |

`\n` breaks a line in any label, participant name, or title. Unquoted names are `[A-Za-z0-9_.]`; quote names with spaces or hyphens and give them an alias. Colors (`#abc`, `#red`, `-[#red]>`), `skinparam`, and `!theme` lines are ignored.
