// SVG → PNG, matching the Rust renderer's `rsvg-convert --zoom 2 --format png`.
// The SVG paints its own white background rect, so no background is set here
// (rsvg-convert's default is transparent too).
//
// resvg is a native module, loaded on first use through createRequire so a
// bundler leaves it external instead of trying to inline
// its .node binary. When it cannot load, rasterUnavailable() says why.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { Resvg as ResvgClass } from "@resvg/resvg-js";

const ZOOM = 2;

type ResvgModule = { Resvg: typeof ResvgClass };

let resvg: ResvgModule | Error | undefined;

function loadResvg(): ResvgModule | Error {
  if (resvg === undefined) {
    try {
      resvg = createRequire(import.meta.url)("@resvg/resvg-js") as ResvgModule;
    } catch (e) {
      resvg = e instanceof Error ? e : new Error(String(e));
    }
  }
  return resvg;
}

/** Why PNGs cannot be written here (resvg's native binary failed to load), or undefined when they can. */
export function rasterUnavailable(): string | undefined {
  const r = loadResvg();
  return r instanceof Error ? r.message : undefined;
}

/**
 * rsvg-convert resolves `Helvetica, Arial, sans-serif` through fontconfig
 * (e.g. Helvetica → Nimbus Sans). resvg matches family names literally, so ask
 * fontconfig for the same substitute and use it as the sans-serif fallback.
 * node:child_process rather than Bun.spawnSync, so Node and Bun pick the same font.
 */
function fontconfigMatch(family: string): string | undefined {
  try {
    const name = execFileSync("fc-match", ["-f", "%{family[0]}", family], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return name !== "" ? name : undefined;
  } catch {
    return undefined;
  }
}

let fallbackFamily: string | undefined | null = null;

export function svgToPng(svg: string): Buffer {
  const r = loadResvg();
  if (r instanceof Error) throw r;
  if (fallbackFamily === null) fallbackFamily = fontconfigMatch("Helvetica");
  const font: { loadSystemFonts: boolean; sansSerifFamily?: string; defaultFontFamily?: string } = { loadSystemFonts: true };
  if (fallbackFamily !== undefined) {
    font.sansSerifFamily = fallbackFamily;
    font.defaultFontFamily = fallbackFamily;
  }
  return new r.Resvg(svg, { fitTo: { mode: "zoom", value: ZOOM }, font }).render().asPng();
}
