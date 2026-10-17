import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { rerunAnalysis } from "../../actions";
import { loadRouteTable } from "./explorer-data";
import { AnalysisProgress } from "./progress";
import { RoutesTable } from "./routes-table";

export const metadata: Metadata = {
  title: "Analysis · Cartograph",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AnalysisPage({ params }: PageProps<"/o/[slug]/analyses/[id]">) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Suspense fallback={<AnalysisSkeleton />}>
        <Analysis params={params} />
      </Suspense>
    </div>
  );
}

async function Analysis({ params }: { params: PageProps<"/o/[slug]/analyses/[id]">["params"] }) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();

  const { analysis, loadedAt } = await loadAnalysis(id);
  if (!analysis) notFound();

  return (
    <>
      <Link
        href={`/o/${slug}`}
        className="rounded-sm text-sm text-fg-muted underline-offset-4 outline-none hover:text-fg hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← All analyses
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight break-words">
        <span className="font-normal text-fg-muted">{analysis.project.repo_owner}/</span>
        {analysis.project.repo_name}
      </h1>
      <p className="mt-1.5 text-sm text-fg-muted">
        <a
          href={`https://github.com/${analysis.project.repo_owner}/${analysis.project.repo_name}`}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-4 hover:text-fg hover:underline"
        >
          github.com/{analysis.project.repo_owner}/{analysis.project.repo_name}
        </a>
        {analysis.project.default_branch && <> · {analysis.project.default_branch}</>}
      </p>

      {/* Keyed on the row's state, so a refresh after the run moves on starts
          the live view from the new row rather than from stale local state. */}
      <AnalysisProgress
        key={`${analysis.status}:${analysis.stage_at ?? analysis.created_at}`}
        analysisId={analysis.id}
        initial={{
          status: analysis.status,
          stage: analysis.stage,
          message: analysis.status === "failed" ? analysis.error : analysis.stage_message,
          at: analysis.stage_at ?? analysis.created_at,
        }}
        createdAt={analysis.created_at}
        result={
          analysis.status === "complete"
            ? { commitSha: analysis.commit_sha, files: analysis.file_count, edges: analysis.edge_count }
            : null
        }
        loadedAt={loadedAt}
        rerun={rerunAnalysis.bind(null, analysis.id)}
      />

      {analysis.status === "complete" && (
        <>
          <Link
            href={`/o/${slug}/analyses/${analysis.id}/map`}
            className="mt-8 inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open the map
          </Link>
          <Suspense fallback={<div aria-hidden className="mt-12 h-32 rounded-lg bg-surface-muted" />}>
            <Routes analysisId={analysis.id} />
          </Suspense>
        </>
      )}
    </>
  );
}

async function Routes({ analysisId }: { analysisId: string }) {
  const table = await loadRouteTable(analysisId);
  if (!table) return null;
  return <RoutesTable routes={table.routes} framework={table.framework} />;
}

// As the signed-in user: another organization's analysis isn't hidden here,
// it simply isn't returned.
async function loadAnalysis(id: string) {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("analyses")
    .select(
      "id, status, stage, stage_message, stage_at, error, commit_sha, file_count, edge_count, created_at, project:projects (repo_owner, repo_name, default_branch)",
    )
    .eq("id", id)
    .maybeSingle();
  // When the row was read; the live view replays anything published since.
  return { analysis: data, loadedAt: Date.now() };
}

function AnalysisSkeleton() {
  return (
    <div aria-hidden>
      <div className="h-4 w-24 rounded bg-surface-muted" />
      <div className="mt-5 h-8 w-64 rounded bg-surface-muted" />
      <div className="mt-3 h-4 w-48 rounded bg-surface-muted" />
      <div className="mt-10 flex flex-col gap-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="size-3 rounded-full bg-surface-muted" />
            <div className="h-4 w-56 rounded bg-surface-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
