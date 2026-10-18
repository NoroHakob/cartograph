"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getIdentity } from "@/lib/identity";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isTimeout, PipelineError } from "@/pipeline/errors";
import { LOOKUP_TIMEOUT_MS, lookupRepository, parseRepoUrl } from "@/pipeline/github";
import { claimAnalysis, runClaimed } from "@/pipeline/run";

export type StartState = { status: "idle" } | { status: "error"; message: string; url: string };

/**
 * The dashboard form. Finds or creates the repository's one analysis and
 * sends you to it. Only a newly created analysis is run: submitting a
 * repository that's already been analysed is a way back to that analysis,
 * never a second run. Re-running is rerunAnalysis, from the analysis itself.
 */
export async function startAnalysis(_prev: StartState, formData: FormData): Promise<StartState> {
  const url = String(formData.get("url") ?? "").trim();
  const error = (message: string): StartState => ({ status: "error", message, url });

  // Re-authorize from the token on every call; never trust the form.
  const identity = await getIdentity();
  if (!identity) return error("You're not signed in to an organization.");

  const ref = parseRepoUrl(url);
  if (!ref) return error("That isn't a GitHub repository. Paste a link like https://github.com/owner/name.");

  // Canonical names, so a different capitalisation finds the same analysis,
  // and a typo or a private repository is refused here rather than as a run
  // that fails a moment later.
  let repo;
  try {
    repo = await lookupRepository(ref, AbortSignal.timeout(LOOKUP_TIMEOUT_MS));
  } catch (e) {
    if (e instanceof PipelineError) return error(e.message);
    if (isTimeout(e)) return error(`GitHub didn't answer within ${LOOKUP_TIMEOUT_MS / 1000} seconds. Try again in a moment.`);
    throw e;
  }

  // As the signed-in user: the organization comes from their token, and RLS
  // decides what they may create.
  const supabase = await createServerSupabaseClient();
  const { data, error: startError } = await supabase
    .rpc("start_analysis", { p_owner: repo.owner, p_name: repo.name, p_default_branch: repo.defaultBranch })
    .single();
  if (startError) return error(`The analysis couldn't be created: ${startError.message}`);

  if (data.created) {
    // Claimed before the redirect, so the page you land on already shows the
    // run as started. The run itself carries on after the response.
    const claim = await claimAnalysis(data.analysis_id);
    if (claim) after(() => runClaimed(claim));
  }
  redirect(`/o/${identity.orgSlug}/analyses/${data.analysis_id}`);
}

export type RerunState = { status: "idle" } | { status: "error"; message: string };

/**
 * Runs an existing analysis again, from its page. Only an analysis that has
 * finished, failed or gone stale can be re-run; one that's in progress
 * stays with the run it has.
 *
 * Bound to an analysis id on its page and used with useActionState, which
 * also passes the previous state; it isn't needed.
 */
export async function rerunAnalysis(analysisId: string): Promise<RerunState> {
  const identity = await getIdentity();
  if (!identity) return { status: "error", message: "You're not signed in to an organization." };

  // Reading it as the signed-in user is the authorization: RLS returns the
  // row only if it belongs to their organization.
  const supabase = await createServerSupabaseClient();
  const { data: analysis } = await supabase.from("analyses").select("id").eq("id", analysisId).maybeSingle();
  if (!analysis) return { status: "error", message: "That analysis doesn't exist in this organization." };

  const claim = await claimAnalysis(analysis.id);
  if (!claim) return { status: "error", message: "This analysis is already running." };
  after(() => runClaimed(claim));
  refresh();
  return { status: "idle" };
}
