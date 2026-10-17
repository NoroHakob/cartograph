"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { Enums } from "@/lib/supabase/database.types";
import { useSupabase } from "@/lib/supabase/client";
import { isStale } from "@/pipeline/stale";
import type { RerunState } from "../../actions";

type Status = Enums<"analysis_status">;
type Stage = Enums<"analysis_stage">;

/** What the database publishes on each stage change, and what the page shows. */
export interface Progress {
  status: Status;
  stage: Stage | null;
  message: string | null;
  /** When the stage last moved. */
  at: string;
}

const STAGES: { id: Stage; title: string; doing: string }[] = [
  { id: "fetch", title: "Download from GitHub", doing: "downloading from GitHub" },
  { id: "select", title: "Pick out the source files", doing: "picking out the source files" },
  { id: "parse", title: "Read every import", doing: "reading the imports" },
  { id: "store", title: "Save the map", doing: "saving the map" },
];

const FINISHED = new Set<Status>(["complete", "failed"]);

/** Replay reaches this far behind the server's read, for clock differences. */
const REPLAY_MARGIN_MS = 5_000;
/** How often staleness is re-checked. Local only; nothing is fetched. */
const CLOCK_TICK_MS = 15_000;

type Connection = "connecting" | "live" | "lost";

export function AnalysisProgress({
  analysisId,
  initial,
  createdAt,
  result,
  loadedAt,
  rerun,
}: {
  analysisId: string;
  initial: Progress;
  createdAt: string;
  result: { commitSha: string | null; files: number | null; edges: number | null } | null;
  loadedAt: number;
  rerun: (prev: RerunState) => Promise<RerunState>;
}) {
  const supabase = useSupabase();
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [now, setNow] = useState(loadedAt);
  const [rerunState, rerunAction, rerunning] = useActionState(rerun, { status: "idle" });

  // Live progress comes from the database: a trigger on the analysis row
  // publishes each stage change to this analysis's private channel. The
  // channel's policy admits only members of the analysis's organization, the
  // same rule as reading the row. Nothing here polls.
  useEffect(() => {
    const channel = supabase.channel(`analysis:${analysisId}`, {
      config: {
        private: true,
        // Anything published between the server reading the row and this
        // subscription would otherwise be missed.
        broadcast: { replay: { since: loadedAt - REPLAY_MARGIN_MS, limit: 25 } },
      },
    });

    channel.on("broadcast", { event: "progress" }, ({ payload }) => {
      const next = readProgress(payload);
      if (!next) return;
      setProgress((current) => {
        // Replayed messages can predate what the server already rendered.
        if (Date.parse(next.at) < Date.parse(current.at)) return current;
        return next;
      });
      // The finished row carries what the stream doesn't (counts, commit):
      // read it once, from the server.
      if (FINISHED.has(next.status)) router.refresh();
    });

    let cancelled = false;
    // The socket authenticates with the Clerk session token, the same one
    // RLS reads, so the policy can see which organization is asking.
    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel.subscribe((status) => {
        setConnection(status === "SUBSCRIBED" ? "live" : status === "CLOSED" ? "connecting" : "lost");
      });
    });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [supabase, analysisId, loadedAt, router]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const finished = FINISHED.has(progress.status);
  const stalled = isStale({ status: progress.status, stage_at: progress.at, created_at: createdAt }, now);
  const failed = progress.status === "failed";
  const current = progress.stage ? STAGES.findIndex((s) => s.id === progress.stage) : -1;

  return (
    <section aria-labelledby="progress-heading" className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="progress-heading" className="text-sm font-medium">
          {headline(progress.status, stalled)}
        </h2>
        {!finished && <ConnectionNote connection={connection} />}
      </div>

      <ol className="mt-5 flex flex-col">
        {STAGES.map((stage, i) => {
          const state: StepState =
            progress.status === "complete" || i < current
              ? "done"
              : i === current
                ? failed
                  ? "failed"
                  : stalled
                    ? "stalled"
                    : "active"
                : "pending";
          return (
            <Step
              key={stage.id}
              title={stage.title}
              state={state}
              last={i === STAGES.length - 1}
              message={i === current && !failed && progress.status !== "complete" ? progress.message : null}
            />
          );
        })}
      </ol>

      <div aria-live="polite" className="mt-6">
        {failed && (
          <div className="border-l-2 border-danger pl-4">
            <p className="text-sm font-medium text-danger">
              Failed while {current >= 0 ? STAGES[current].doing : "starting"}
            </p>
            <p className="mt-1 text-sm break-words text-fg">{progress.message ?? "No reason was recorded."}</p>
          </div>
        )}
        {stalled && !failed && (
          <p className="border-l-2 border-border pl-4 text-sm text-fg-muted">
            Nothing has moved since {new Date(progress.at).toLocaleTimeString()}. The process running it has
            probably stopped; starting it again is safe.
          </p>
        )}
        {progress.status === "complete" && result && (
          <p className="text-sm text-fg-muted">
            {result.files !== null && <>{result.files.toLocaleString("en")} files</>}
            {result.edges !== null && <>, {result.edges.toLocaleString("en")} edges</>}
            {result.commitSha && (
              <>
                {" "}at <code className="font-mono text-[13px] text-fg">{result.commitSha.slice(0, 7)}</code>
              </>
            )}
            .
          </p>
        )}
      </div>

      {(finished || stalled) && (
        <form action={rerunAction} className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={rerunning}
            className="h-9 rounded-md border border-border bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-surface-muted disabled:opacity-60"
          >
            {rerunning ? "Starting…" : progress.status === "complete" ? "Analyse the latest commit" : "Run it again"}
          </button>
          {rerunState.status === "error" && (
            <span role="alert" className="text-sm text-danger">
              {rerunState.message}
            </span>
          )}
        </form>
      )}
    </section>
  );
}

type StepState = "done" | "active" | "stalled" | "failed" | "pending";

const STEP_LABEL: Record<StepState, string> = {
  done: "done",
  active: "in progress",
  stalled: "stalled",
  failed: "failed",
  pending: "not started",
};

function Step({ title, state, message, last }: { title: string; state: StepState; message: string | null; last: boolean }) {
  return (
    <li
      aria-current={state === "active" || state === "stalled" || state === "failed" ? "step" : undefined}
      className="grid grid-cols-[1.25rem_1fr] gap-x-3"
    >
      <span aria-hidden className="flex flex-col items-center">
        <Marker state={state} />
        {!last && <span className={`w-px flex-1 ${state === "done" ? "bg-fg" : "bg-border"}`} />}
      </span>
      <div className={last ? "" : "pb-6"}>
        <p className={`text-sm leading-5 ${state === "pending" ? "text-fg-muted" : "font-medium text-fg"}`}>
          {title}
          <span className="sr-only">, {STEP_LABEL[state]}</span>
        </p>
        {message && <p className="mt-0.5 text-sm break-words text-fg-muted">{message}</p>}
      </div>
    </li>
  );
}

function Marker({ state }: { state: StepState }) {
  const ring = "relative mt-1 grid size-3 shrink-0 place-items-center rounded-full border";
  switch (state) {
    case "done":
      return <span className={`${ring} border-fg bg-fg`} />;
    case "active":
      return (
        <span className={`${ring} border-accent bg-accent text-accent`}>
          <span className="absolute inset-0 rounded-full bg-current opacity-50 motion-safe:animate-ping" />
        </span>
      );
    case "stalled":
      return <span className={`${ring} border-fg-muted bg-surface-muted`} />;
    case "failed":
      return <span className={`${ring} border-danger bg-danger`} />;
    case "pending":
      return <span className={`${ring} border-border bg-surface`} />;
  }
}

function ConnectionNote({ connection }: { connection: Connection }) {
  if (connection === "live") {
    return <span className="text-[13px] text-fg-muted">Live</span>;
  }
  return (
    <span className="text-[13px] text-fg-muted">
      {connection === "connecting" ? "Connecting…" : "Live updates interrupted, reconnecting…"}
    </span>
  );
}

function headline(status: Status, stalled: boolean): string {
  if (stalled) return "Stalled";
  switch (status) {
    case "queued":
      return "Waiting to start";
    case "parsing":
    case "explaining":
      return "Mapping the repository";
    case "complete":
      return "Mapped";
    case "failed":
      return "Failed";
  }
}

const STATUSES = new Set<string>(["queued", "parsing", "explaining", "complete", "failed"]);
const STAGE_IDS = new Set<string>(STAGES.map((s) => s.id));

/** The published payload, checked rather than trusted. */
function readProgress(payload: unknown): Progress | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.status !== "string" || !STATUSES.has(p.status) || typeof p.at !== "string") return null;
  return {
    status: p.status as Status,
    stage: typeof p.stage === "string" && STAGE_IDS.has(p.stage) ? (p.stage as Stage) : null,
    message: typeof p.message === "string" ? p.message : null,
    at: p.at,
  };
}
