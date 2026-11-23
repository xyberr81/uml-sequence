// Sequence diagrams: PlantUML subset source → SVG.
import { parse } from "./parse.ts";
import { render } from "./render.ts";

export { parse, type Diagram, type Ev } from "./parse.ts";
export { render, RenderError } from "./render.ts";
export { htmlPage } from "./svg.ts";

export interface SequenceOutput {
  svg: string;
  /** The `title` lines joined with spaces, or null when the source has none. */
  title: string | null;
  /** Parse warnings (one per skipped line) followed by layout warnings. */
  warnings: string[];
}

/** Parse and render in one step. Throws RenderError if the source has no participants. */
export function renderSequence(src: string): SequenceOutput {
  const parsed = parse(src);
  const drawn = render(parsed.diagram);
  const title = parsed.diagram.title?.join(" ") ?? null;
  return { svg: drawn.svg, title, warnings: [...parsed.warnings, ...drawn.warnings] };
}
