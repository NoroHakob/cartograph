// RECONSTRUCTION, not a recovered artifact.
//
// The explanation prompt has only ever had one version in this repository:
// PROMPT_VERSION is 1 and no earlier prompt was committed. This file was
// written afterwards, for the prompt-version experiment, as a plausible first
// draft: the same inputs as version 1 (the file, every neighbour both ways,
// the source), with none of what version 1 adds. There are no ground rules
// about naming only listed paths or inferring no connections, no permitted
// formatting subset, and no length limit.
//
// So the comparison measures what those additions are worth, against a
// baseline built to lack them. It does not say how the app used to behave.
//
// It lives with the evals and nothing in src/ imports it: the app ships one
// prompt, and a dead one isn't kept alive in the product so a test can reach it.

import type { Prompt } from "@/ai/client";
import type { FileSubject, Neighbour } from "@/explain/prompts";
import { MAX_SOURCE_CHARS } from "@/explain/prompts";

export const RETIRED_PROMPT_VERSION = 0;

/** Every path this prompt shows the model. */
export function shownPaths(subject: FileSubject): string[] {
  return [subject.path, ...subject.imports.map((n) => n.path), ...subject.importedBy.map((n) => n.path)];
}

const list = (neighbours: readonly Neighbour[]) => (neighbours.length === 0 ? "(none)" : neighbours.map((n) => `- ${n.path}`).join("\n"));

export function filePrompt(subject: FileSubject, source: string | null): Prompt {
  const shown = source === null ? null : source.slice(0, MAX_SOURCE_CHARS);
  return {
    system: "You are a senior software engineer. Explain what the following file does and how it fits into the codebase.",
    user: [
      `File: ${subject.path}`,
      "",
      "Imports:",
      list(subject.imports),
      "",
      "Imported by:",
      list(subject.importedBy),
      "",
      shown === null ? "(source unavailable)" : `Source:\n${shown}`,
    ].join("\n"),
  };
}
