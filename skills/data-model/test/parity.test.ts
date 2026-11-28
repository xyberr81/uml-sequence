// Every fixture renders to the golden SVG, HTML page and warnings. The goldens were
// written by ratchet's `render er`, so they pin this copy to its exact output.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { renderEr } from "../src/er.ts";
import { htmlPage } from "../src/svg.ts";

const dir = import.meta.dirname;
const fixtures = readdirSync(join(dir, "fixtures"))
  .filter((n) => n.endsWith(".puml"))
  .map((n) => n.slice(0, -".puml".length))
  .sort();

const golden = (name: string, ext: string): string => readFileSync(join(dir, "golden", `${name}.${ext}`), "utf8");

test("has fixtures", () => assert.ok(fixtures.length >= 6));

for (const name of fixtures) {
  test(name, () => {
    const out = renderEr(readFileSync(join(dir, "fixtures", `${name}.puml`), "utf8"));
    assert.equal(out.warnings.map((w) => `warning: ${w}\n`).join(""), golden(name, "stderr"));
    assert.equal(out.svg, golden(name, "svg"));
    assert.equal(htmlPage(`${name}.puml`, out.svg), golden(name, "html"));
  });
}
