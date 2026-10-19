"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { applyEvent, startTurn, type AskStep, type AskTurn } from "@/ask/conversation";
import type { AskEvent } from "@/ask/events";
import type { AskSelection } from "@/ask/selection";
import { LinkedProse, type PathLinks } from "./explanation";

export type { AskSelection };

export interface AskConversation {
  turns: AskTurn[];
  /** Every path a lookup returned in this conversation: the only paths an answer links. */
  paths: readonly string[];
  running: boolean;
  send: (question: string, selection: AskSelection | null) => void;
  stop: () => void;
  reset: () => void;
}

/**
 * One conversation about one analysis. Held by the workspace, above the pane,
 * so toggling Ask off and on again keeps it.
 */
export function useAskConversation(analysisId: string): AskConversation {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [paths, setPaths] = useState<readonly string[]>([]);
  const [running, setRunning] = useState(false);
  const threadId = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const send = useCallback(
    async (question: string, selection: AskSelection | null) => {
      const id = crypto.randomUUID();
      const update = (change: (turn: AskTurn) => AskTurn) => setTurns((all) => all.map((t) => (t.id === id ? change(t) : t)));
      setTurns((all) => [...all, startTurn(id, question, selection)]);
      setRunning(true);
      const controller = new AbortController();
      abort.current = controller;
      const lookingUp = new Set<string>();
      const apply = (event: AskEvent) => {
        update((t) => applyEvent(t, event, lookingUp));
        if (event.type === "result" && event.paths.length > 0) setPaths((all) => [...new Set([...all, ...event.paths])]);
      };

      try {
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ analysisId, message: question, threadId: threadId.current ?? undefined, selection }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          update((t) => ({ ...t, status: "error", error: body?.error ?? "The question couldn't be sent." }));
          return;
        }
        threadId.current = response.headers.get("x-thread-id") ?? threadId.current;

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) apply(JSON.parse(line) as AskEvent);
        }
        apply({ type: "done" });
      } catch {
        if (controller.signal.aborted) update((t) => ({ ...t, status: "stopped", draft: null }));
        else update((t) => ({ ...t, status: t.status === "running" ? "error" : t.status, error: t.error ?? "The connection to the agent dropped." }));
      } finally {
        abort.current = null;
        setRunning(false);
      }
    },
    [analysisId],
  );

  const stop = useCallback(() => abort.current?.abort(), []);
  const reset = useCallback(() => {
    abort.current?.abort();
    threadId.current = null;
    setTurns([]);
    setPaths([]);
  }, []);

  return { turns, paths, running, send, stop, reset };
}

const STARTERS = ["Where is authentication handled?", "Which files does everything depend on?", "Are there any import cycles?", "What are the routes?"];

interface AskPanelProps {
  repository: string;
  conversation: AskConversation;
  selection: AskSelection | null;
  links: PathLinks;
}

/**
 * The right-hand pane in Ask mode: one conversation about this analysis.
 * Every lookup the agent makes is listed above its answer as it happens.
 */
export function AskPanel({ repository, conversation, selection, links }: AskPanelProps) {
  const { turns, paths, running, send, stop, reset } = conversation;
  const [draft, setDraft] = useState("");
  // The selection rides along unless set aside, and is offered again whenever it changes.
  const [setAside, setSetAside] = useState<string | null>(null);
  const selectionKey = selection ? `${selection.kind}:${selection.path}` : null;
  const attached = selection && setAside !== selectionKey ? selection : null;
  const end = useRef<HTMLDivElement>(null);

  const last = turns.at(-1);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns.length, last?.steps.length, last?.draft?.text.length, last?.answer, last?.status]);

  const ask = (question: string) => {
    const text = question.trim();
    if (!text || running) return;
    send(text, attached);
    setDraft("");
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    ask(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      ask(draft);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 flex items-start gap-2 border-b border-border bg-surface px-4 pt-3 pb-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-wide text-fg-muted uppercase">Ask</p>
          <h2 className="mt-0.5 truncate text-base font-semibold" title={repository}>
            {repository}
          </h2>
        </div>
        {turns.length > 0 && (
          <button type="button" onClick={reset} className="mt-0.5 text-xs text-fg-muted hover:text-fg" title="Start a new conversation">
            New
          </button>
        )}
      </header>

      <div className="flex flex-1 flex-col" aria-live="polite">
        {turns.length === 0 ? (
          <div className="px-4 py-5">
            <p className="text-sm text-fg-muted">
              Ask about how this repository fits together. The answer is looked up in this map, and every lookup is shown as it happens.
            </p>
            <ul className="mt-4 flex flex-col gap-1.5">
              {(attached?.kind === "file" ? ["What breaks if I change this file?", ...STARTERS.slice(0, 3)] : STARTERS).map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => ask(q)}
                    className="w-full rounded-md border border-border px-2.5 py-1.5 text-left text-sm hover:bg-surface-muted"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-fg-muted">It can&apos;t judge code quality or read code. It only knows what the map records.</p>
          </div>
        ) : (
          turns.map((turn) => <Turn key={turn.id} turn={turn} paths={paths} links={links} />)
        )}
        <div ref={end} />
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-0 border-t border-border bg-surface px-3 pt-2 pb-3">
        {attached && (
          <div className="mb-2 flex items-center gap-1.5 text-xs">
            <span className="text-fg-muted">About</span>
            <span className="min-w-0 truncate rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px]" title={attached.path}>
              {attached.path === "." ? `${repository} (root)` : attached.path}
            </span>
            <button
              type="button"
              onClick={() => setSetAside(selectionKey)}
              className="text-fg-muted hover:text-fg"
              aria-label="Don't include the selection"
              title="Ask without the selection"
            >
              ×
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={2000}
            placeholder={turns.length === 0 ? "Ask about this repository" : "Ask a follow-up"}
            aria-label="Question"
            className="min-h-[2.75rem] flex-1 resize-none rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm outline-none placeholder:text-fg-muted focus:border-accent"
          />
          {running ? (
            <button type="button" onClick={stop} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-muted">
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim()}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              Ask
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Turn({ turn, paths, links }: { turn: AskTurn; paths: readonly string[]; links: PathLinks }) {
  const looking = turn.status === "running" && !turn.draft && turn.answer === null;
  return (
    <article className="border-b border-border px-4 py-3">
      <p className="text-sm font-medium whitespace-pre-wrap">{turn.question}</p>
      {turn.selection && (
        <p className="mt-0.5 truncate text-[11px] text-fg-muted" title={turn.selection.path}>
          About <span className="font-mono">{turn.selection.path}</span>
        </p>
      )}

      {turn.steps.length > 0 && (
        <ol className="mt-2.5 flex flex-col gap-1" aria-label="Lookups">
          {turn.steps.map((step) => (
            <Step key={step.id} step={step} />
          ))}
        </ol>
      )}
      {looking && (
        <p className="mt-2.5 flex items-center gap-2 text-xs text-fg-muted">
          <Dot status="running" />
          {turn.steps.length === 0 ? "Thinking about where to look…" : "Deciding what to look up next…"}
        </p>
      )}

      {turn.answer !== null ? (
        <div className="mt-3">
          <LinkedProse text={turn.answer} paths={paths} links={links} />
          {turn.steps.length === 0 && (
            <p className="mt-2 text-xs text-danger">Nothing was looked up for this answer, so nothing on the map backs it.</p>
          )}
        </div>
      ) : turn.draft ? (
        <p className="mt-3 text-sm leading-6 whitespace-pre-wrap">{turn.draft.text}</p>
      ) : null}

      {turn.status === "error" && <p className="mt-3 text-sm text-danger">{turn.error}</p>}
      {turn.status === "stopped" && <p className="mt-3 text-xs text-fg-muted">Stopped.</p>}
      {turn.status === "done" && turn.answer === null && (
        <p className="mt-3 text-sm text-fg-muted">No answer came back. Try asking more narrowly.</p>
      )}
    </article>
  );
}

function Step({ step }: { step: AskStep }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <Dot status={step.status} />
      <span className="min-w-0 flex-1">
        <span className="break-words">{describe(step)}</span>
        {step.summary && <span className={`block ${step.status === "failed" ? "text-danger" : "text-fg-muted"}`}>{step.summary}</span>}
      </span>
    </li>
  );
}

function Dot({ status }: { status: AskStep["status"] }) {
  const label = { running: "Looking up", done: "Looked up", failed: "Lookup failed" }[status];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`mt-1 size-2 shrink-0 rounded-full ${status === "running" ? "animate-pulse bg-accent" : status === "done" ? "bg-fg-muted" : "bg-danger"}`}
    />
  );
}

const code = (text: unknown) => <span className="font-mono break-all">{String(text)}</span>;

/** What a lookup does, in words. */
function describe({ tool, args }: AskStep): ReactNode {
  switch (tool) {
    case "repo_summary":
      return "Read the repository summary";
    case "find_files":
      return <>Searched paths for {code(`"${args.query}"`)}</>;
    case "files_by_role":
      return <>Listed files with the role {code(args.role)}</>;
    case "neighbours":
      return <>Read the imports of {code(args.path)}</>;
    case "walk":
      return args.direction === "dependencies" ? (
        <>Followed what {code(args.path)} depends on</>
      ) : (
        <>Followed what depends on {code(args.path)}</>
      );
    case "routes":
      return "Read the route table";
    default:
      return <>Looked up {code(tool)}</>;
  }
}
