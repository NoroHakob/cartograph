// What an Explain request sends back. Plain data: the pane imports it.

import type { ClassifiableRole } from "@/parser/taxonomy";

export type ExplainTarget = { kind: "file"; path: string } | { kind: "folder"; dir: string };

export const targetKey = (target: ExplainTarget) => (target.kind === "file" ? `file:${target.path}` : `folder:${target.dir}`);

/**
 * Whether what was explained still matches the repository. Checked against
 * GitHub on every request; a check that can't be made says why rather than
 * passing.
 */
export type Staleness =
  | { status: "current" }
  /** The branch has moved on, but this file's bytes are what was analysed. */
  | { status: "moved"; head: string; fileUnchanged: boolean | null }
  /** This file is different at the branch's head. */
  | { status: "changed"; head: string }
  /** This file no longer exists at the branch's head. */
  | { status: "removed"; head: string }
  | { status: "unknown"; reason: string };

export interface Explanation {
  target: ExplainTarget;
  body: string;
  model: string;
  /** True when the cache answered and no model was called. */
  cached: boolean;
  /** Every path handed to the model: the only ones the answer may name. */
  paths: string[];
  /** Source paths the answer named that it wasn't handed. Shown, never linked. */
  unknownPaths: string[];
  /** Set when the file was unidentified and this explanation classified it. */
  role: { role: ClassifiableRole; rationale: string | null } | null;
  /** The commit the explanation is about. */
  analysedCommit: string;
  staleness: Staleness;
  tracing: { enabled: boolean; project?: string; reason?: string };
}

export type ExplainResult = { ok: true; explanation: Explanation } | { ok: false; error: string };
