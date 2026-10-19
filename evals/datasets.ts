// The eval datasets: what's on disk under evals/datasets, and how it is read.
// Built once by scripts/eval-build.mjs from real parses of public
// repositories and committed, so every experiment runs against the same
// examples, and a change to them is a change in review.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { FileSubject } from "@/explain/prompts";
import type { ClassifiableRole } from "@/parser/taxonomy";

export const DATASET_DIR = path.join(process.cwd(), "evals", "datasets");

/** Where an example came from: enough to fetch the exact bytes again. */
export interface Origin {
  repo: string;
  commit: string;
  framework: string;
}

/**
 * A file convention identified, with the role hidden. `subject.role` is the
 * unidentified catch-all, exactly as a file no adapter matched reaches the
 * model; the role convention gave it is the reference, kept out of the inputs.
 */
export interface RoleExample {
  inputs: { origin: Origin; subject: FileSubject; source: string };
  outputs: { role: ClassifiableRole };
}

/** A file to explain, as the app would see it: its real role, its real neighbours. */
export interface ExplainExample {
  inputs: { origin: Origin; subject: FileSubject; source: string };
  outputs: Record<string, never>;
}

export const ROLES_FILE = path.join(DATASET_DIR, "roles.json");
export const EXPLAIN_FILE = path.join(DATASET_DIR, "explain.json");

export function readDataset<T>(file: string): T[] {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T[];
  } catch (error) {
    throw new Error(
      `couldn't read ${path.relative(process.cwd(), file)} (${error instanceof Error ? error.message : String(error)}). Build it with: node --env-file=.env.local scripts/eval-build.mjs`,
    );
  }
}
