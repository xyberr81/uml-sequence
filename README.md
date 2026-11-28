# skills

Agent skills for Claude Code. Each one lives in its own folder under `skills/` with its own README, tests and dependencies.

| Skill | What it draws |
| --- | --- |
| [uml-sequence](skills/uml-sequence) | Black-and-white UML sequence diagrams as PNG, SVG or HTML |
| [data-model](skills/data-model) | Database schema diagrams: tables with column types and PK/FK keys, joined by crow's-foot relations |

Both take a `.puml` file in a small PlantUML subset and render it with a bundled Node renderer. They need Node 22.18 or later and no system libraries.

## Install

Clone once, then link each skill you want into `~/.claude/skills/`:

```sh
git clone https://github.com/xyberr81/skills ~/skills
for s in uml-sequence data-model; do
  ln -s ~/skills/skills/$s ~/.claude/skills/$s
  (cd ~/.claude/skills/$s && npm install)
done
```

Each skill's steps call its renderer at `~/.claude/skills/<name>/`, so keep that path.

## License

[MIT](LICENSE)
