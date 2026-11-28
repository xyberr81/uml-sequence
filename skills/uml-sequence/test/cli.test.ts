// The CLI as the skill runs it: which file it writes, what it prints, and its exit code.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const dir = import.meta.dirname;
const cli = join(dir, "..", "src", "cli.ts");
const tmp = mkdtempSync(join(tmpdir(), "uml-sequence-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: tmp, encoding: "utf8" });
const fixture = (name: string): string => {
  const path = join(tmp, `${name}.puml`);
  copyFileSync(join(dir, "fixtures", `${name}.puml`), path);
  return path;
};

test("defaults to a PNG beside the source and writes nothing else", () => {
  const src = fixture("flow");
  const r = run(src);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${join(tmp, "flow.png")}\n`);
  assert.deepEqual(readFileSync(join(tmp, "flow.png")).subarray(1, 4).toString(), "PNG");
  assert.deepEqual(readdirSync(tmp).filter((n) => n.startsWith("flow.")).sort(), ["flow.png", "flow.puml"]);
});

test("svg and html outputs match the goldens", () => {
  const src = fixture("arrows");
  assert.equal(run(src, "a.svg").status, 0);
  assert.equal(readFileSync(join(tmp, "a.svg"), "utf8"), readFileSync(join(dir, "golden", "arrows.svg"), "utf8"));
  assert.equal(run("arrows.puml", "a.html").status, 0);
  assert.equal(readFileSync(join(tmp, "a.html"), "utf8"), readFileSync(join(dir, "golden", "arrows.html"), "utf8"));
});

test("prints each skipped line and counts them after the path", () => {
  const r = run(fixture("warnings"), "w.svg");
  assert.equal(r.status, 0);
  assert.equal(r.stderr, readFileSync(join(dir, "golden", "warnings.stderr"), "utf8"));
  assert.match(r.stdout, /^w\.svg \(\d+ warnings?\)\n$/);
});

test("exits 1 with an error when there is nothing to draw", () => {
  const r = run(fixture("empty"), "e.svg");
  assert.equal(r.status, 1);
  assert.equal(r.stderr, "error: no participants or messages found\n");
  assert.equal(existsSync(join(tmp, "e.svg")), false);
});

test("exits 1 when the source cannot be read", () => {
  const r = run("missing.puml");
  assert.equal(r.status, 1);
  assert.equal(r.stderr, "error: cannot read missing.puml: No such file or directory (os error 2)\n");
});

test("exits 2 on bad usage", () => {
  for (const args of [[], ["-h"], ["a", "b", "c"]]) assert.equal(run(...args).status, 2, args.join(" "));
});
