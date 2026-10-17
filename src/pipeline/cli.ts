// Usage:
//   pnpm analyze <github url | owner/name> --org <clerk org id>
//   pnpm analyze <github url | owner/name> --dry-run
//
// Runs the pipeline without the app. With --org, finds or creates the
// project and its one analysis in that organization (which must already have
// a row) and runs it into storage, exactly as the app will. With --dry-run it
// fetches, selects and parses into a temporary directory, prints what the run
// would store, and touches no database.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { downloadArchive, parseRepoUrl, resolveSnapshot } from "./github";
import { parseInWorker } from "./parse";
import { runAnalysis } from "./run";
import { selectFromArchive } from "./select";

async function main(argv: string[]): Promise<number> {
  let input: string | undefined;
  let orgId: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--org") orgId = argv[++i];
    else if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--")) return usage(`unknown flag ${arg}`);
    else if (input === undefined) input = arg;
    else return usage(`unexpected argument ${arg}`);
  }
  const ref = input ? parseRepoUrl(input) : null;
  if (!ref) return usage(input ? `not a GitHub repository: ${input}` : "missing repository");
  if (dryRun === (orgId !== undefined)) return usage("pass exactly one of --org <id> or --dry-run");

  return dryRun ? dry(ref) : run(ref, orgId!);
}

async function run(ref: { owner: string; name: string }, orgId: string): Promise<number> {
  const db = createAdminSupabaseClient();
  // Canonical names first, so "Honojs/Hono" and "honojs/hono" are one project.
  const snapshot = await resolveSnapshot(ref);

  const { data: project, error: projectError } = await db
    .from("projects")
    .upsert(
      { org_id: orgId, repo_owner: snapshot.owner, repo_name: snapshot.name, default_branch: snapshot.defaultBranch },
      { onConflict: "org_id,repo_owner,repo_name" },
    )
    .select("id")
    .single();
  if (projectError) return fatal(`couldn't find or create the project: ${projectError.message}`);

  // One analysis per repository: an existing one is re-run, never duplicated.
  const { error: insertError } = await db
    .from("analyses")
    .upsert({ org_id: orgId, project_id: project.id }, { onConflict: "project_id", ignoreDuplicates: true });
  if (insertError) return fatal(`couldn't create the analysis: ${insertError.message}`);
  const { data: analysis, error: analysisError } = await db
    .from("analyses")
    .select("id")
    .eq("project_id", project.id)
    .single();
  if (analysisError) return fatal(`couldn't read the analysis: ${analysisError.message}`);

  console.log(`analysis    ${analysis.id}  (${snapshot.owner}/${snapshot.name})`);
  const started = performance.now();
  const outcome = await runAnalysis(analysis.id, {
    db,
    onStage: (stage, message) => console.log(`${stage.padEnd(12)}${message}`),
  });
  const took = `${((performance.now() - started) / 1000).toFixed(1)} s`;

  if (outcome.status === "busy") return fatal("another run holds this analysis; try again once it finishes or goes stale");
  if (outcome.status === "failed") {
    console.log(`\nfailed in ${outcome.stage}: ${outcome.error}`);
    return 1;
  }
  const { data: row } = await db
    .from("analyses")
    .select("status, stage_message, commit_sha, file_count, edge_count")
    .eq("id", analysis.id)
    .single();
  console.log(`\n${row?.status}    ${row?.stage_message} at ${row?.commit_sha}  (${took})`);
  return 0;
}

async function dry(ref: { owner: string; name: string }): Promise<number> {
  const workdir = mkdtempSync(path.join(tmpdir(), "cartograph-"));
  try {
    const snapshot = await resolveSnapshot(ref);
    console.log(`fetch       ${snapshot.owner}/${snapshot.name}@${snapshot.commitSha} (${snapshot.defaultBranch})`);
    const archive = path.join(workdir, "archive.tar.gz");
    const bytes = await downloadArchive(snapshot, archive);
    console.log(`            ${(bytes / 1024 / 1024).toFixed(1)} MB archive`);

    const root = path.join(workdir, "repo", snapshot.name);
    mkdirSync(root, { recursive: true });
    const s = await selectFromArchive(archive, root);
    console.log(`select      ${s.entries} entries: ${s.kept} kept, ${s.placeholders} placeholders, ${s.skipped.count} skipped`);
    for (const ex of s.skipped.examples.slice(0, 10)) console.log(`              ${ex.reason.padEnd(16)}${ex.path}`);

    const { result, problems } = await parseInWorker(root);
    const c = result.coverage;
    console.log(`parse       ${result.files.length} files, ${result.imports.length} imports, ${result.edges.length} edges, ${result.routes.length} routes`);
    console.log(`            ${c.internal} internal, ${c.external} external, ${c.excluded} excluded, ${c.unresolved} unresolved (${(c.classifiedRatio * 100).toFixed(1)}% classified)`);
    console.log(`            invariants ${problems.length === 0 ? "all hold" : `${problems.length} broken: ${problems[0]}`}`);
    console.log(`store       skipped (dry run)`);
    return problems.length === 0 ? 0 : 1;
  } finally {
    rmSync(workdir, { recursive: true, force: true, maxRetries: 3 });
  }
}

function usage(error: string): number {
  console.error(`error: ${error}\n`);
  console.error("usage: pnpm analyze <github url | owner/name> (--org <clerk org id> | --dry-run)");
  return 1;
}

function fatal(message: string): number {
  console.error(`error: ${message}`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
