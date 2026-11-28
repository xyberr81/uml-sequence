// Data-model diagrams: PlantUML IE subset source → SVG.
import { parse } from "./parse.ts";
import { render } from "./render.ts";

export interface ErOutput {
  svg: string;
  /** One per skipped or doubtful line. */
  warnings: string[];
}

export function renderEr(source: string): ErOutput {
  const { model, warnings } = parse(source);
  return { svg: render(model), warnings };
}

/** The parsed model and its warnings, without drawing it. */
export const parseEr = parse;
