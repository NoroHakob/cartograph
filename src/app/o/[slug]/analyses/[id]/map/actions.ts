"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { explain } from "@/explain/explain";
import type { ExplainResult, ExplainTarget } from "@/explain/types";
import { getIdentity } from "@/lib/identity";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { claimAnalysis, runClaimed } from "@/pipeline/run";

const MAX_PATH = 1024;

/**
 * Explains a file or a folded folder of a complete analysis. The target is
 * all the browser sends; everything around it is read from stored parser
 * output on the server.
 *
 * Bound to an analysis id on the map page.
 */
export async function explainTarget(analysisId: string, target: ExplainTarget): Promise<ExplainResult> {
  // Never trust the shape of what the browser sent.
  const valid =
    (target?.kind === "file" && typeof target.path === "string" && target.path.length > 0 && target.path.length <= MAX_PATH) ||
    (target?.kind === "folder" && typeof target.dir === "string" && target.dir.length > 0 && target.dir.length <= MAX_PATH);
  if (!valid) return { ok: false, error: "Nothing to explain." };

  const identity = await getIdentity();
  if (!identity) return { ok: false, error: "You're not signed in to an organization." };

  // Reading it as the signed-in user is the authorization: RLS returns the
  // row only if it belongs to their organization. Every later read and write
  // goes through the same client and the same policies.
  const db = await createServerSupabaseClient();
  const { data: analysis } = await db
    .from("analyses")
    .select("id, org_id, status, commit_sha, project:projects (repo_owner, repo_name, default_branch)")
    .eq("id", analysisId)
    .maybeSingle();
  if (!analysis?.project) return { ok: false, error: "That analysis doesn't exist in this organization." };
  if (analysis.status !== "complete" || !analysis.commit_sha) return { ok: false, error: "This analysis isn't complete, so there's nothing to explain yet." };

  return explain(
    {
      db,
      orgId: analysis.org_id,
      analysisId: analysis.id,
      repo: { owner: analysis.project.repo_owner, name: analysis.project.repo_name },
      defaultBranch: analysis.project.default_branch,
      commitSha: analysis.commit_sha,
    },
    target,
  );
}

/**
 * Re-runs the analysis from the map, when an explanation is stale, and goes
 * to the analysis page to watch it. Returns only when it couldn't start.
 */
export async function reanalyse(analysisId: string): Promise<{ error: string }> {
  const identity = await getIdentity();
  if (!identity) return { error: "You're not signed in to an organization." };

  const db = await createServerSupabaseClient();
  const { data: analysis } = await db.from("analyses").select("id").eq("id", analysisId).maybeSingle();
  if (!analysis) return { error: "That analysis doesn't exist in this organization." };

  const claim = await claimAnalysis(analysis.id);
  if (!claim) return { error: "This analysis is already running." };
  after(() => runClaimed(claim));
  redirect(`/o/${identity.orgSlug}/analyses/${analysis.id}`);
}
