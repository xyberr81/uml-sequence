// Every fixture renders to the golden SVG, HTML page and warnings. The goldens were
// written by the original Rust renderer, so they pin this port to its exact output.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { htmlPage, RenderError, renderSequence } from "../src/sequence.ts";

const dir = import.meta.dirname;
const fixtures = readdirSync(join(dir, "fixtures"))
  .filter((n) => n.endsWith(".puml"))
  .map((n) => n.slice(0, -".puml".length))
  .sort();

const golden = (name: string, ext: string): string => readFileSync(join(dir, "golden", `${name}.${ext}`), "utf8");

test("has fixtures", () => assert.ok(fixtures.length >= 6));

for (const name of fixtures) {
  test(name, () => {
    const src = readFileSync(join(dir, "fixtures", `${name}.puml`), "utf8");
    const stderr = golden(name, "stderr");
    if (Number(golden(name, "exit").trim()) !== 0) {
      const message = stderr.replace(/^error: /, "").trimEnd();
      assert.throws(() => renderSequence(src), (e) => e instanceof RenderError && e.message === message);
      return;
    }
    const out = renderSequence(src);
    assert.equal(out.warnings.map((w) => `warning: ${w}\n`).join(""), stderr);
    assert.equal(out.svg, golden(name, "svg"));
    assert.equal(htmlPage(out.title ?? `${name}.puml`, out.svg), golden(name, "html"));
  });
}
