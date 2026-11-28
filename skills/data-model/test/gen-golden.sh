#!/usr/bin/env bash
# Regenerate test/golden/ after an intentional change to the look, then review the diff.
# The goldens started as ratchet's `render er` output; every change since is in git.
set -u
here=$(cd "$(dirname "$0")" && pwd)
cli="$here/../src/cli.ts"
for src in "$here"/fixtures/*.puml; do
  name=$(basename "$src" .puml)
  rm -f "$here/golden/$name.svg" "$here/golden/$name.html"
  node "$cli" "$src" "$here/golden/$name.svg" >/dev/null 2>"$here/golden/$name.stderr"
  # The page title is the input path, so render from fixtures/ with a bare name.
  (cd "$here/fixtures" && node "$cli" "$name.puml" "$here/golden/$name.html" >/dev/null 2>&1)
done
