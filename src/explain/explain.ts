import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AiError, annotateRun, generateObject, generateText, MODEL, traced, tracingStatus } from "@/ai/client";
import type { Database } from "@/lib/supabase/database.types";
import { isClassifiableRole, type ClassifiableRole } from "@/parser/taxonomy";
import { PipelineError } from "@/pipeline/errors";
import { fetchRawFile, headCommit, LOOKUP_TIMEOUT_MS, type RepoRef } from "@/pipeline/github";
import { unknownPaths } from "./format";
import { CLASSIFY_SCHEMA, classifies, filePrompt, folderPrompt, handedPaths, PROMPT_VERSION, type FileSubject, type Subject } from "./prompts";
import { loadFileSubject, loadFolderSubject } from "./subject";
import type { ExplainResult, ExplainTarget, Staleness } from "./types";

type Db = SupabaseClient<Database>;

/** One complete analysis, read as the signed-in user. */
export interface AnalysisContext {
  db: Db;
  orgId: string;
  analysisId: string;
  repo: RepoRef;
  defaultBranch: string | null;
  commitSha: string;
}

interface Answer {
  body: string;
  role: ClassifiableRole | null;
  rationale: string | null;
  cached: boolean;
}

/**
 * Explains a file or a folded folder of a complete analysis. The cache is
 * read inside the traced run, so a hit is recorded as a run with no model
 * call in it. Staleness is checked against GitHub alongside, every time.
 */
export async function explain(ctx: AnalysisContext, target: ExplainTarget): Promise<ExplainResult> {
  let subject: Subject | null;
  let fileId: string | null = null;
  if (target.kind === "file") {
    const loaded = await loadFileSubject(ctx.db, ctx.analysisId, target.path);
    subject = loaded?.subject ?? null;
    fileId = loaded?.fileId ?? null;
  } else {
    subject = await loadFolderSubject(ctx.db, ctx.analysisId, target.dir);
  }
  if (!subject) return { ok: false, error: "The parser didn't record that in this analysis." };

  const [answer, staleness] = await Promise.all([
    answerFor(ctx, subject).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    checkStaleness(ctx, subject),
  ]);
  if (!answer.ok) {
    if (answer.error instanceof AiError) return { ok: false, error: answer.error.message };
    console.error("[explain] failed:", answer.error);
    return { ok: false, error: "The explanation couldn't be written. The server log has the details." };
  }
  const { body, role, rationale, cached } = answer.value;

  // Recorded on the analysis's file even on a cache hit: a re-run replaces
  // the file rows, and the role with them, while the cache entry lives on.
  if (role && fileId) {
    const { error } = await ctx.db
      .from("file_roles")
      .upsert({ org_id: ctx.orgId, analysis_id: ctx.analysisId, file_id: fileId, role, rationale, model: MODEL }, { onConflict: "file_id,model" });
    if (error) console.warn(`[explain] couldn't record the role of ${subject.kind === "file" ? subject.path : ""}: ${error.message}`);
  }

  const paths = handedPaths(subject);
  return {
    ok: true,
    explanation: {
      target,
      body,
      model: MODEL,
      cached,
      paths,
      unknownPaths: unknownPaths(body, new Set(paths)),
      role: role ? { role, rationale } : null,
      analysedCommit: ctx.commitSha,
      staleness,
      tracing: tracingStatus(),
    },
  };
}

/** Keyed on everything the prompt is built from, and on the model and the prompt itself. */
function cacheKey(subject: Subject): string {
  return createHash("sha256").update(JSON.stringify({ prompt: PROMPT_VERSION, model: MODEL, subject })).digest("hex");
}

function answerFor(ctx: AnalysisContext, subject: Subject): Promise<Answer> {
  const key = cacheKey(subject);
  // Built per request so the database client is closed over, never logged
  // as one of the run's inputs.
  const lookup = traced("cache lookup", async (cacheKey: string) => {
    const { data, error } = await ctx.db
      .from("explanation_cache")
      .select("body, role, rationale")
      .eq("org_id", ctx.orgId)
      .eq("key", cacheKey)
      .maybeSingle();
    if (error) console.warn(`[explain] cache read failed, asking the model: ${error.message}`);
    return data ?? null;
  });

  const run = traced(subject.kind === "file" ? "explain file" : "explain folder", async (input: { analysisId: string; key: string; subject: Subject }) => {
    const hit = await lookup(input.key);
    if (hit) {
      annotateRun({ cache: "hit" });
      return { body: hit.body, role: isClassifiableRole(hit.role) ? hit.role : null, rationale: hit.rationale, cached: true };
    }
    annotateRun({ cache: "miss" });

    const answer = input.subject.kind === "file" ? await askAboutFile(ctx, input.subject) : await askAboutFolder(ctx, input.subject);
    const { error } = await ctx.db
      .from("explanation_cache")
      .upsert(
        { org_id: ctx.orgId, key: input.key, kind: input.subject.kind, model: MODEL, body: answer.body, role: answer.role, rationale: answer.rationale },
        { onConflict: "org_id,key", ignoreDuplicates: true },
      );
    if (error) console.warn(`[explain] couldn't cache the explanation: ${error.message}`);
    return { ...answer, cached: false };
  });

  return run({ analysisId: ctx.analysisId, key, subject });
}

async function askAboutFile(ctx: AnalysisContext, subject: FileSubject): Promise<Omit<Answer, "cached">> {
  // The bytes at the analysed commit: what the parser read, so what the
  // neighbour lists describe.
  let source: string | null = null;
  try {
    const bytes = await fetchRawFile(ctx.repo, ctx.commitSha, subject.path, AbortSignal.timeout(LOOKUP_TIMEOUT_MS));
    if (bytes) {
      source = bytes.toString("utf8");
      annotateRun({ source_matches_parse: sha256(bytes) === subject.hash });
    }
  } catch (error) {
    console.warn(`[explain] couldn't read ${subject.path} from GitHub: ${error instanceof Error ? error.message : String(error)}`);
  }
  const prompt = filePrompt(subject, source);

  if (!classifies(subject)) return { body: await generateText(prompt), role: null, rationale: null };

  const answer = await generateObject(prompt, CLASSIFY_SCHEMA, "explain_and_classify");
  const body = typeof answer.explanation === "string" ? answer.explanation.trim() : "";
  if (!body) throw new AiError("The model returned an empty answer.");
  // The schema already limits the role to the list; this is the check that
  // doesn't depend on the model obeying it. Anything else is dropped.
  const role = isClassifiableRole(answer.role) ? answer.role : null;
  if (!role) console.warn(`[explain] discarded role ${JSON.stringify(answer.role)} for ${subject.path}: not a classifiable role`);
  const rationale = role && typeof answer.rationale === "string" && answer.rationale.trim() ? answer.rationale.trim() : null;
  return { body, role, rationale };
}

async function askAboutFolder(ctx: AnalysisContext, subject: Subject & { kind: "folder" }): Promise<Omit<Answer, "cached">> {
  return { body: await generateText(folderPrompt(subject, ctx.repo.name)), role: null, rationale: null };
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

/**
 * Branch heads, briefly. Anonymous GitHub allows 60 API requests an hour,
 * and clicking around a map shouldn't spend them; this is short enough that
 * a push is noticed on the next click or two.
 */
const HEAD_TTL_MS = 20 * 1000;
const heads = new Map<string, { sha: string; at: number }>();

async function branchHead(repo: RepoRef, branch: string): Promise<string> {
  const key = `${repo.owner}/${repo.name}@${branch}`.toLowerCase();
  const known = heads.get(key);
  if (known && Date.now() - known.at < HEAD_TTL_MS) return known.sha;
  const sha = await headCommit(repo, branch, AbortSignal.timeout(LOOKUP_TIMEOUT_MS));
  heads.set(key, { sha, at: Date.now() });
  return sha;
}

async function checkStaleness(ctx: AnalysisContext, subject: Subject): Promise<Staleness> {
  if (!ctx.defaultBranch) return { status: "unknown", reason: "The analysis didn't record which branch it read." };
  try {
    const head = await branchHead(ctx.repo, ctx.defaultBranch);
    if (head === ctx.commitSha) return { status: "current" };
    if (subject.kind === "folder") return { status: "moved", head, fileUnchanged: null };
    // Raw files by full sha are immutable and don't spend API quota.
    const bytes = await fetchRawFile(ctx.repo, head, subject.path, AbortSignal.timeout(LOOKUP_TIMEOUT_MS));
    if (bytes === null) return { status: "removed", head };
    return sha256(bytes) === subject.hash ? { status: "moved", head, fileUnchanged: true } : { status: "changed", head };
  } catch (error) {
    const reason = error instanceof PipelineError ? error.message : "GitHub couldn't be reached to check.";
    return { status: "unknown", reason };
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
