#!/usr/bin/env node
// Render a PlantUML-subset sequence diagram to PNG, SVG, or a standalone HTML page.
// Usage: uml-sequence <in.puml> [out.png|out.svg|out.html]   (out defaults to <in>.png)
// Exit codes: 2 for usage, 1 for errors, 0 on success (warnings are printed but do not fail the run).
// Syntax reference: SKILL.md.
import { readFileSync, writeFileSync } from "node:fs";
import { svgToPng } from "./raster.ts";
import { htmlPage, RenderError, renderSequence } from "./sequence.ts";

function fail(msg: string, code: number): never {
  console.error(msg);
  process.exit(code);
}

/** Rust-style io error text, so messages read the same as the original Rust binary. */
function ioMessage(e: unknown): string {
  if (e instanceof TypeError) return "stream did not contain valid UTF-8";
  if (e instanceof Error && "code" in e) {
    const known: Record<string, string> = {
      ENOENT: "No such file or directory (os error 2)",
      EACCES: "Permission denied (os error 13)",
      EISDIR: "Is a directory (os error 21)",
    };
    return known[String(e.code)] ?? e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

const args = process.argv.slice(2);
if (args.length > 2 || args.some((a) => a.startsWith("-"))) fail("usage: uml-sequence <in.puml> [out.png|out.svg|out.html]", 2);
const input = args[0] ?? fail("usage: uml-sequence <in.puml> [out.png|out.svg|out.html]", 2);
const output =
  args[1] ??
  (() => {
    const low = input.toLowerCase();
    const ext = [".puml", ".plantuml", ".txt"].find((e) => low.endsWith(e));
    return `${ext === undefined ? input : input.slice(0, input.length - ext.length)}.png`;
  })();

let src: string;
try {
  src = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(input));
} catch (e) {
  fail(`error: cannot read ${input}: ${ioMessage(e)}`, 1);
}

let drawn;
try {
  drawn = renderSequence(src);
} catch (e) {
  if (e instanceof RenderError) fail(`error: ${e.message}`, 1);
  throw e;
}

let data: string | Uint8Array;
if (output.endsWith(".svg")) data = drawn.svg;
else if (output.endsWith(".html")) data = htmlPage(drawn.title ?? input, drawn.svg);
else {
  try {
    data = svgToPng(drawn.svg);
  } catch (e) {
    fail(`error: rasterizing failed: ${e instanceof Error ? e.message : String(e)}`, 1);
  }
}
try {
  writeFileSync(output, data);
} catch (e) {
  fail(`error: cannot write ${output}: ${ioMessage(e)}`, 1);
}

for (const w of drawn.warnings) console.error(`warning: ${w}`);
const n = drawn.warnings.length;
console.log(n > 0 ? `${output} (${n} warning${n > 1 ? "s" : ""})` : output);
