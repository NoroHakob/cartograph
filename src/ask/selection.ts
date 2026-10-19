// What's selected on the map when a question is asked, and how the agent is
// told. Shared by /api/ask and the Ask evaluation, so both send the agent the
// same words.

export interface AskSelection {
  kind: "file" | "folder";
  path: string;
}

const MAX_PATH_LENGTH = 1_000;

/** A selection from a request body: null for none, undefined for one that's malformed. */
export function parseSelection(value: unknown): AskSelection | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") return undefined;
  const { kind, path } = value as { kind?: unknown; path?: unknown };
  if ((kind !== "file" && kind !== "folder") || typeof path !== "string" || !path || path.length > MAX_PATH_LENGTH || /[\r\n`]/.test(path)) {
    return undefined;
  }
  return { kind, path };
}

/**
 * The question as the agent reads it. The selection rides along on a line of
 * its own, in the form instructions.md describes, so "this file" means
 * something and later turns still know what it was.
 */
export function withSelection(question: string, selection: AskSelection | null): string {
  return selection ? `${question}\n\n(Selected on the map: ${selection.kind} \`${selection.path}\`)` : question;
}
