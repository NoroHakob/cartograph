// One Ask turn as the panel holds it, and how each event from /api/ask moves
// it along. Plain data and a pure function: the panel's hook applies events
// as they arrive, and the same function can replay a recorded stream.

import type { AskEvent } from "./events";
import type { AskSelection } from "./selection";

export interface AskStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "failed";
  summary?: string;
}

export interface AskTurn {
  id: string;
  question: string;
  selection: AskSelection | null;
  steps: AskStep[];
  /** The answer as it's being written, before the whole of it arrives. */
  draft: { message: string; text: string } | null;
  answer: string | null;
  status: "running" | "done" | "error" | "stopped";
  error?: string;
}

export function startTurn(id: string, question: string, selection: AskSelection | null): AskTurn {
  return { id, question, selection, steps: [], draft: null, answer: null, status: "running" };
}

/**
 * `turn` after `event`. `lookingUp` collects the model turns that asked for a
 * lookup during this turn: anything they wrote is working notes, not the
 * answer, so their text is dropped even when it streamed in first.
 */
export function applyEvent(turn: AskTurn, event: AskEvent, lookingUp: Set<string>): AskTurn {
  switch (event.type) {
    case "step":
      lookingUp.add(event.message);
      return {
        ...turn,
        draft: turn.draft?.message === event.message ? null : turn.draft,
        steps: [...turn.steps, { id: event.id, tool: event.tool, args: event.args, status: "running" }],
      };
    case "result":
      return {
        ...turn,
        steps: turn.steps.map((s) => (s.id === event.id ? { ...s, status: event.ok ? "done" : "failed", summary: event.summary } : s)),
      };
    case "text":
      if (lookingUp.has(event.message)) return turn;
      return { ...turn, draft: { message: event.message, text: (turn.draft?.message === event.message ? turn.draft.text : "") + event.text } };
    case "answer":
      return { ...turn, draft: null, answer: event.text };
    case "error":
      return { ...turn, status: "error", error: event.message };
    case "done":
      return turn.status === "running" ? { ...turn, status: "done", draft: null } : turn;
  }
}
