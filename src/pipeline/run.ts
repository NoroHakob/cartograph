import "server-only";

import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { isTimeout, PipelineError, SupersededError } from "./errors";
import { downloadArchive, FETCH_TIMEOUT_MS, resolveSnapshot, type RepoRef } from "./github";
import { parseInWorker } from "./parse";
import { selectFromArchive } from "./select";
import { STALE_AFTER_MS } from "./stale";
import { storeParse } from "./store";

export type Stage = Database["public"]["Enums"]["analysis_stage"];
type Db = SupabaseClient<Database>;

export type RunOutcome =
  | { status: "complete"; commitSha: string; files: number; imports: number }
  | { status: "failed"; stage: Stage; error: string }
  /** Another run holds the analysis, or it doesn't exist. Nothing was written. */
  | { status: "busy" }
  /**
   * This run went stale and another claimed the analysis while it was still
   * going. It stopped at its next write, and wrote nothing from then on: the
   * row is the other run's.
   */
  | { status: "superseded" };

export interface RunOptions {
  db?: Db;
  /** Called after each stage change is written. */
  onStage?: (stage: Stage, message: string) => void;
}

/** A claimed analysis: this run, and only this run, may now write to it. */
export interface Claim {
  analysisId: string;
  /**
   * Stamped on the row by the claim. Every later write requires it, so once
   * another run claims the analysis this run's writes match nothing.
   */
  runId: string;
  repo: RepoRef;
}

const MAX_ERROR_LENGTH = 2000;

/** Claims the analysis and runs it. See claimAnalysis and runClaimed. */
export async function runAnalysis(analysisId: string, options: RunOptions = {}): Promise<RunOutcome> {
  const db = options.db ?? createAdminSupabaseClient();
  const claim = await claimAnalysis(analysisId, db);
  return claim ? runClaimed(claim, { ...options, db }) : { status: "busy" };
}

/**
 * Takes the analysis for a run, unless another run already has it: only a
 * queued, finished, or stale analysis can be claimed. The conditional update
 * is the lock, so two runs racing for one analysis can't both win. A claimed
 * analysis already reads as started, before any of the run has happened.
 *
 * Claiming a stale analysis doesn't stop the run that went stale; it may
 * still be going. The fresh run_id is what keeps it off the row from now on.
 *
 * Returns null when the analysis is busy or doesn't exist.
 */
export async function claimAnalysis(analysisId: string, db: Db = createAdminSupabaseClient()): Promise<Claim | null> {
  const now = new Date();
  const runId = randomUUID();
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  const { data, error } = await db
    .from("analyses")
    .update({
      run_id: runId,
      status: "parsing",
      stage: "fetch",
      stage_message: "Starting",
      // stage_at is stamped by the database whenever the stage moves, so the
      // whole progress timeline is on one clock.
      started_at: now.toISOString(),
      finished_at: null,
      error: null,
    })
    .eq("id", analysisId)
    .or(`status.in.(queued,complete,failed),stage_at.is.null,stage_at.lt.${staleBefore}`)
    .select("projects(repo_owner, repo_name)")
    .maybeSingle();
  if (error) throw new Error(`couldn't claim analysis ${analysisId}: ${error.message}`);
  if (!data?.projects) return null;
  return { analysisId, runId, repo: { owner: data.projects.repo_owner, name: data.projects.repo_name } };
}

/**
 * Runs a claimed analysis end to end: fetch the repository's archive from
 * GitHub, select what the parser reads out of it, parse, store. Every stage is
 * written to the analysis before it starts, so the row always says what the
 * run is doing, and the database publishes each change to the progress page.
 *
 * Never throws. Whatever goes wrong is written to the analysis as a failure,
 * with the stage it happened in, instead of leaving the row mid-parse. Every
 * write, the failure included, lands only while this run holds the analysis;
 * a run that has been superseded stops and leaves the row alone.
 */
export async function runClaimed(claim: Claim, options: RunOptions = {}): Promise<RunOutcome> {
  const db = options.db ?? createAdminSupabaseClient();
  const { analysisId, runId, repo } = claim;

  let stage: Stage = "fetch";
  const enter = async (next: Stage, message: string) => {
    stage = next;
    const { data, error } = await db
      .from("analyses")
      .update({ stage: next, stage_message: message })
      .eq("id", analysisId)
      .eq("run_id", runId)
      .select("id");
    if (error) throw new Error(`couldn't record the ${next} stage: ${error.message}`);
    if (data.length === 0) throw new SupersededError(`analysis ${analysisId} was claimed by another run`);
    options.onStage?.(next, message);
  };

  let workdir: string | undefined;
  try {
    workdir = mkdtempSync(path.join(tmpdir(), "cartograph-"));
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    await enter("fetch", `Looking up ${repo.owner}/${repo.name} on GitHub`);
    const snapshot = await resolveSnapshot(repo, signal);
    const label = `${snapshot.owner}/${snapshot.name}@${snapshot.commitSha.slice(0, 7)}`;
    await enter("fetch", `Downloading ${label} (${snapshot.defaultBranch})`);
    const archive = path.join(workdir, "archive.tar.gz");
    const archiveBytes = await downloadArchive(snapshot, archive, signal);

    await enter("select", `Unpacking a ${megabytes(archiveBytes)} archive`);
    // Named after the repository: the parser names a module without a
    // package.json after its directory.
    const root = path.join(workdir, "repo", snapshot.name);
    mkdirSync(root, { recursive: true });
    const selection = await selectFromArchive(archive, root);
    rmSync(archive, { force: true });

    await enter("parse", `Reading the imports in ${label}`);
    const { result, problems } = await parseInWorker(root);
    if (problems.length > 0) {
      throw new Error(`the parser's output broke ${problems.length} invariant(s), first: ${problems[0]}`);
    }
    if (result.files.length === 0) {
      throw new PipelineError(`${snapshot.owner}/${snapshot.name} has no TypeScript or JavaScript files to parse.`);
    }

    await enter("store", `Storing ${count(result.files.length, "file")} and ${count(result.imports.length, "import")}`);
    await storeParse(db, analysisId, runId, snapshot, result, selection);

    return { status: "complete", commitSha: snapshot.commitSha, files: result.files.length, imports: result.imports.length };
  } catch (error) {
    if (error instanceof SupersededError) return superseded(analysisId, stage);
    const message = describe(error);
    if (!(error instanceof PipelineError) && !isTimeout(error)) console.error(`[pipeline] analysis ${analysisId} failed in ${stage}:`, error);
    if ((await fail(db, claim, stage, message)) === "superseded") return superseded(analysisId, stage);
    return { status: "failed", stage, error: message };
  } finally {
    if (workdir) rmSync(workdir, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** Records the failure, if this run still holds the analysis. */
async function fail(db: Db, claim: Claim, stage: Stage, message: string): Promise<"recorded" | "superseded" | "unrecorded"> {
  const { data, error } = await db
    .from("analyses")
    .update({ status: "failed", stage, error: message, finished_at: new Date().toISOString() })
    .eq("id", claim.analysisId)
    .eq("run_id", claim.runId)
    .select("id");
  if (error) {
    // Nothing left to record it in. The row goes stale and says so.
    console.error(`[pipeline] couldn't record the failure of analysis ${claim.analysisId}: ${error.message}`);
    return "unrecorded";
  }
  return data.length === 0 ? "superseded" : "recorded";
}

function superseded(analysisId: string, stage: Stage): RunOutcome {
  console.warn(`[pipeline] analysis ${analysisId}: another run claimed it while this one was in ${stage}; stopped without writing`);
  return { status: "superseded" };
}

function describe(error: unknown): string {
  const text =
    error instanceof PipelineError
      ? error.message
      : isTimeout(error)
        ? `GitHub took longer than ${FETCH_TIMEOUT_MS / 60_000} minutes to send the repository.`
        : // The stage is stored alongside, and every view names it.
          `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function count(n: number, noun: string): string {
  return `${n.toLocaleString("en")} ${noun}${n === 1 ? "" : "s"}`;
}
