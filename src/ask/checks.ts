// Checks on an Ask answer that need no model. The evaluation scores with
// them; they are word lists and set membership, so they are exact about what
// they look for and blind to everything else. Each says what it found.

import { TOOL_NAMES } from "./tools";

/** Inline code: a run of backticks, its contents, the same run again. */
const CODE_SPAN = /(`+)[\s\S]*?\1/g;
/** Anything shaped like a path or a file name, which may legitimately contain any word. */
const PATH_TOKEN = /[^\s`'"()]*(?:\/|\.[A-Za-z0-9])[^\s`'"()]*/g;

/** The answer's own words: code spans and path-like tokens taken out. */
function prose(text: string): string {
  return text.replace(CODE_SPAN, " ").replace(PATH_TOKEN, " ");
}

/**
 * Words that guess where a lookup could have known. "Might break" about a
 * file the walk found is still a guess about something the walk settled.
 * Phrases a person would use when going by a file's name ("going by its
 * name") are not here: the instructions ask for exactly that.
 */
const HEDGES = [
  /\bprobably\b/i,
  /\b(most )?likely\b/i,
  /\bpresumably\b/i,
  /\bpossibly\b/i,
  /\bperhaps\b/i,
  /\btypically\b/i,
  /\busually\b/i,
  /\bgenerally\b/i,
  /\bin most (cases|projects|codebases)\b/i,
  /\b(might|may|could) (be|have|contain|live|handle|use)\b/i,
  /\bI (think|believe|assume|suspect|guess|imagine)\b/i,
  /\bI'd (guess|assume|expect)\b/i,
  /\bwould (typically|normally|usually)\b/i,
];

/** Hedging phrases in the answer's prose, as written, in order of appearance. */
export function hedges(answer: string): string[] {
  const text = prose(answer);
  const found = HEDGES.flatMap((pattern) => [...text.matchAll(new RegExp(pattern.source, "gi"))].map((m) => ({ at: m.index ?? 0, text: m[0] })));
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.text.toLowerCase()))];
}

/**
 * Words about the agent's own workings. Tool names count wherever they are,
 * code span or not; the generic words count only in prose, since a path like
 * `src/api/json.ts` is the repository talking, not the agent.
 */
const TOOL_NAME = new RegExp(`\\b(${TOOL_NAMES.join("|")})\\b(?=\\s*(\\(|\`|tool|function|call|lookup)|\`)|\\b(repo_summary|find_files|files_by_role)\\b`, "i");
const PLUMBING = [
  /\btools?\b/i,
  /\bfunction calls?\b/i,
  /\bAPI\b/,
  /\bHTTP\b/,
  /\bJSON\b/,
  /\bendpoint I\b/i,
  /\bcredentials?\b/i,
  /\bbearer\b/i,
  /\bLOOKUP_FAILED\b/,
  /\bsystem prompt\b/i,
  /\bmy (instructions|prompt|configuration|context window)\b/i,
  /\bstatus code\b/i,
  /\b(the|a) (server|backend|database) (returned|responded|said|failed)\b/i,
];

/** Plumbing mentioned in the answer, as written. */
export function plumbing(answer: string): string[] {
  const found: string[] = [];
  const tool = TOOL_NAME.exec(answer);
  if (tool) found.push(tool[0]);
  const text = prose(answer);
  for (const pattern of PLUMBING) {
    const match = pattern.exec(text);
    if (match) found.push(match[0]);
  }
  return [...new Set(found.map((f) => f.toLowerCase()))];
}

/** A lookup as the evaluation records it. */
export interface Lookup {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
}

/** Lookups that returned something: a failed one is not a reason to believe anything. */
export function successfulLookups(lookups: readonly Lookup[]): Lookup[] {
  return lookups.filter((l) => l.ok);
}

/**
 * Whether a follow-up looked at a file the conversation had already reached:
 * "that" resolved to something real rather than to nothing or a guess.
 * `earlier` is every path earlier turns' lookups returned.
 */
export function followedUp(lookups: readonly Lookup[], earlier: ReadonlySet<string>): string | null {
  for (const lookup of lookups) {
    const path = lookup.args.path;
    if (lookup.ok && typeof path === "string" && earlier.has(path)) return path;
  }
  return null;
}
