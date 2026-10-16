import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Enums } from "@/lib/supabase/database.types";

type Status = Enums<"analysis_status">;

type Analysis = {
  id: string;
  status: Status;
  commit_sha: string | null;
  file_count: number | null;
  edge_count: number | null;
  error: string | null;
  created_at: string;
};

type Repository = {
  id: string;
  owner: string;
  name: string;
  analyses: Analysis[];
};

/**
 * The organization's analyses, grouped by repository, most recent activity first.
 *
 * There is deliberately no organization filter here. The request carries the
 * Clerk session token, and the row-level security policy on `analyses` (and
 * on `projects`, for the embedded repository) keeps only rows whose org_id
 * matches the token's organization claim. Switching organization changes the
 * token, so the same query returns a different list. If this ever shows
 * another organization's row, the bug is in the policy, not here.
 */
export async function Analyses() {
  const { analyses, error, loadedAt } = await loadAnalyses();

  if (error) {
    return (
      <p role="alert" className="mt-8 border-l-2 border-danger pl-4 text-sm text-danger">
        Analyses couldn&apos;t be loaded: {error.message}. Reload the page to try again.
      </p>
    );
  }

  if (!analyses || analyses.length === 0) {
    return (
      <div className="mt-8 border-t border-border pt-8">
        <Route status="queued" muted />
        <h3 className="mt-5 text-lg font-semibold tracking-tight">Nothing mapped yet</h3>
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-fg-muted">
          When this team maps a repository, it shows up here with each analysis as it moves from
          queued to complete.
        </p>
      </div>
    );
  }

  const repositories = groupByRepository(analyses);
  const inProgress = analyses.filter((a) => a.status !== "complete" && a.status !== "failed").length;

  return (
    <>
      <p className="mt-1.5 text-sm text-fg-muted">
        {count(repositories.length, "repository", "repositories")}
        {inProgress > 0 && `, ${count(inProgress, "analysis", "analyses")} in progress`}
      </p>

      <ol className="mt-8 border-t border-border">
        {repositories.map((repo) => (
          <li key={repo.id} className="border-b border-border py-5">
            <h3 className="text-[15px] font-semibold tracking-tight">
              <span className="font-normal text-fg-muted">{repo.owner}/</span>
              {repo.name}
            </h3>
            <ol className="mt-3 flex flex-col gap-3 sm:gap-2" aria-label={`Analyses of ${repo.owner}/${repo.name}`}>
              {repo.analyses.map((analysis) => (
                <AnalysisRow key={analysis.id} analysis={analysis} now={loadedAt} />
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </>
  );
}

function AnalysisRow({ analysis, now }: { analysis: Analysis; now: number }) {
  const failed = analysis.status === "failed";
  const facts = [
    analysis.file_count !== null && count(analysis.file_count, "file", "files"),
    analysis.edge_count !== null && count(analysis.edge_count, "import", "imports"),
  ].filter(Boolean);

  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_6.5rem_1fr_auto]">
      <Route status={analysis.status} />
      <span className={`font-medium ${STATUS_TONE[analysis.status]}`}>{STATUS_LABEL[analysis.status]}</span>

      <span className="col-span-3 min-w-0 row-start-2 text-fg-muted sm:col-span-1 sm:row-start-auto">
        {failed && analysis.error ? (
          <span className="text-danger">{analysis.error}</span>
        ) : (
          <>
            {analysis.commit_sha && (
              <code className="mr-3 font-mono text-[13px] text-fg">{analysis.commit_sha.slice(0, 7)}</code>
            )}
            {facts.join(", ")}
          </>
        )}
      </span>

      <time
        dateTime={analysis.created_at}
        title={new Date(analysis.created_at).toUTCString()}
        className="col-start-3 row-start-1 text-right text-[13px] whitespace-nowrap text-fg-muted tabular-nums sm:col-start-4"
      >
        {relativeTime(analysis.created_at, now)}
      </time>
    </li>
  );
}

// The pipeline every analysis travels. `failed` has no stop of its own: the
// line turns red, because the row doesn't record which stage it failed in.
const STOPS = ["Queued", "Parsing", "Explaining", "Complete"] as const;
const STAGE: Record<Status, number | null> = {
  queued: 0,
  parsing: 1,
  explaining: 2,
  complete: 3,
  failed: null,
};

const STATUS_LABEL: Record<Status, string> = {
  queued: "Queued",
  parsing: "Parsing",
  explaining: "Explaining",
  complete: "Complete",
  failed: "Failed",
};

const STATUS_TONE: Record<Status, string> = {
  queued: "text-fg-muted",
  parsing: "text-accent",
  explaining: "text-accent",
  complete: "text-fg",
  failed: "text-danger",
};

/**
 * Four stops joined by a line. Stops already passed are filled; the current
 * stop is filled and, while work is happening on it, pulses.
 */
function Route({ status, muted = false }: { status: Status; muted?: boolean }) {
  const stage = STAGE[status];
  const failed = stage === null;
  const live = status === "parsing" || status === "explaining";
  const label = failed
    ? "Analysis failed"
    : `Stage ${stage + 1} of ${STOPS.length}: ${STOPS[stage]}`;

  return (
    <span
      role="img"
      aria-label={muted ? undefined : label}
      aria-hidden={muted || undefined}
      className={`relative inline-flex w-[5.5rem] translate-y-[-1px] items-center self-center ${
        failed ? "text-danger" : status === "complete" ? "text-fg" : "text-accent"
      } ${muted ? "opacity-40" : ""}`}
    >
      {STOPS.map((stop, i) => {
        const reached = !failed && i <= stage;
        const current = !failed && i === stage;
        return (
          <span key={stop} className="contents">
            {i > 0 && (
              <span
                aria-hidden
                className={`h-px flex-1 ${failed ? "bg-current opacity-60" : i <= stage ? "bg-current" : "bg-border"}`}
              />
            )}
            <span aria-hidden className="relative grid size-2.5 shrink-0 place-items-center">
              {current && live && (
                <span className="absolute inset-0 rounded-full bg-current opacity-50 motion-safe:animate-ping" />
              )}
              <span
                className={`size-full rounded-full border ${
                  failed
                    ? "border-current bg-surface"
                    : reached
                      ? "border-current bg-current"
                      : "border-border bg-surface"
                } ${current && status !== "complete" ? "ring-2 ring-current/20" : ""}`}
              />
            </span>
          </span>
        );
      })}
    </span>
  );
}

async function loadAnalyses() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("analyses")
    .select(
      "id, status, commit_sha, file_count, edge_count, error, created_at, project:projects (id, repo_owner, repo_name)",
    )
    .order("created_at", { ascending: false });
  // Relative times are measured from when the rows were read.
  return { analyses: data, error, loadedAt: Date.now() };
}

// Rows arrive newest first, so each repository's first row is its most recent
// activity and Map insertion order already sorts the groups.
function groupByRepository(
  rows: (Analysis & { project: { id: string; repo_owner: string; repo_name: string } })[],
): Repository[] {
  const groups = new Map<string, Repository>();
  for (const { project, ...analysis } of rows) {
    let repo = groups.get(project.id);
    if (!repo) {
      repo = { id: project.id, owner: project.repo_owner, name: project.repo_name, analyses: [] };
      groups.set(project.id, repo);
    }
    repo.analyses.push(analysis);
  }
  return [...groups.values()];
}

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeTime(iso: string, now: number): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function AnalysesSkeleton() {
  return (
    <div aria-hidden>
      <div className="mt-2.5 h-4 w-56 rounded bg-surface-muted" />
      <div className="mt-8 border-t border-border">
        {[0, 1, 2].map((i) => (
          <div key={i} className="border-b border-border py-5">
            <div className="h-4 w-40 rounded bg-surface-muted" />
            <div className="mt-4 flex items-center gap-4">
              <div className="h-2.5 w-[5.5rem] rounded-full bg-surface-muted" />
              <div className="h-4 w-20 rounded bg-surface-muted" />
              <div className="h-4 flex-1 rounded bg-surface-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
