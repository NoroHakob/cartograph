// The invented-path check over every cached explanation.
//
//   node --env-file=.env.local scripts/eval-paths.mjs [--splice]
//
// No model calls. The cache stores each answer under a hash of the subject
// it was written about, not the subject itself, so the subject is rebuilt
// from stored parser output with the app's own loaders and matched by that
// hash. Its handed paths are then exactly the paths that answer was shown.
//
// --splice turns the check on itself: a made-up path is written into each
// answer in several forms, and the report says how many the check caught.
//
// Reads every organization's cache with the service key: a local script for
// the person who runs this app, like `pnpm analyze`, never code a browser reaches.

import path from "node:path";
import { MODEL } from "@/ai/client";
import { cacheKey } from "@/explain/explain";
import { inventedPaths } from "@/explain/invented";
import { handedPaths, PROMPT_VERSION, type Subject } from "@/explain/prompts";
import { loadFileSubject, loadFolderSubject } from "@/explain/subject";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { paged } from "@/lib/supabase/paged";
import { fold } from "@/map/fold";

type Db = ReturnType<typeof createAdminSupabaseClient>;

interface Cached {
  orgId: string;
  key: string;
  kind: string;
  model: string;
  body: string;
}

interface Recovered extends Cached {
  subject: Subject;
  repo: string;
}

/** Subjects loaded at once while scanning an analysis. */
const PARALLEL = 8;

export async function main(argv: string[]): Promise<number> {
  const splice = argv.includes("--splice");
  const unknown = argv.filter((a) => a !== "--splice");
  if (unknown.length > 0) {
    console.error(`error: unexpected ${unknown.join(" ")}\nusage: pnpm eval:paths [--splice]`);
    return 1;
  }

  const db = createAdminSupabaseClient();
  const cached: Cached[] = (
    await paged((from, to) => db.from("explanation_cache").select("org_id, key, kind, model, body").order("org_id").order("key").range(from, to))
  ).map((r) => ({ orgId: r.org_id, key: r.key, kind: r.kind, model: r.model, body: r.body }));

  const { recovered, unmatched } = await recover(db, cached);
  console.log(`cached      ${cached.length} explanations; ${recovered.length} matched to their subject`);
  if (unmatched.length > 0) {
    // A key covers the prompt version, the model and the exact subject. Any
    // of those changing since, or the analysis being re-run or deleted,
    // leaves an answer whose inputs can't be rebuilt, so it can't be checked.
    const stale = unmatched.filter((c) => c.model !== MODEL).length;
    console.log(
      `            ${unmatched.length} not checked: their subject isn't in any stored analysis as prompt v${PROMPT_VERSION} on ${MODEL} would see it${stale > 0 ? ` (${stale} from another model)` : ""}`,
    );
  }
  if (recovered.length === 0) {
    console.log("\nnothing to check");
    return 0;
  }

  return splice ? runSplice(recovered) : runCheck(recovered);
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

function runCheck(recovered: Recovered[]): number {
  let failures = 0;
  console.log("");
  for (const r of recovered) {
    const invented = inventedPaths(r.body, handedPaths(r.subject));
    if (invented.length === 0) continue;
    failures++;
    console.log(`✗ ${r.repo}  ${label(r.subject)}\n    invented: ${invented.join(", ")}`);
  }
  if (failures === 0) console.log("no invented paths");
  const passed = recovered.length - failures;
  console.log(`\npass rate   ${passed}/${recovered.length} (${percent(passed, recovered.length)}) named only paths they were shown`);
  return failures === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// --splice
// ---------------------------------------------------------------------------

/** One way a made-up path can appear in prose. */
interface Form {
  name: string;
  /** The sentence to insert, and the token the check should report. */
  build: (madeUp: MadeUp) => { sentence: string; expect: string } | null;
}

interface MadeUp {
  /** A sibling file that doesn't exist, e.g. src/lib/db-legacy.ts. */
  file: string;
  /** A subfolder that doesn't exist, e.g. src/lib/legacy; null at the root. */
  folder: string | null;
  /** The made-up file as a relative import, e.g. ./db-legacy. */
  relative: string;
}

const FORMS: Form[] = [
  { name: "inline code", build: (m) => ({ sentence: `It also re-exports \`${m.file}\`.`, expect: m.file }) },
  { name: "prose, end of sentence", build: (m) => ({ sentence: `It also re-exports ${m.file}.`, expect: m.file }) },
  { name: "in parentheses", build: (m) => ({ sentence: `It is wrapped elsewhere (see ${m.file}).`, expect: m.file }) },
  { name: "bold", build: (m) => ({ sentence: `The real work happens in **${m.file}**.`, expect: m.file }) },
  { name: "relative import", build: (m) => ({ sentence: `It is imported as \`${m.relative}\` by older code.`, expect: m.relative }) },
  { name: "folder, no extension", build: (m) => (m.folder ? { sentence: `Older helpers live in ${m.folder}.`, expect: m.folder } : null) },
];

function runSplice(recovered: Recovered[]): number {
  const byForm = new Map(FORMS.map((f) => [f.name, { tried: 0, caught: 0 }]));
  const missed: string[] = [];
  let skipped = 0;

  for (const r of recovered) {
    const shown = handedPaths(r.subject);
    const madeUp = makeUp(r.subject, shown);
    for (const form of FORMS) {
      const built = form.build(madeUp);
      if (!built) {
        skipped++;
        continue;
      }
      const tally = byForm.get(form.name)!;
      tally.tried++;
      const found = inventedPaths(insert(r.body, built.sentence), shown);
      if (found.includes(built.expect)) tally.caught++;
      else missed.push(`${form.name.padEnd(24)}${r.repo}  ${label(r.subject)}: "${built.sentence}" -> ${found.length > 0 ? `reported ${found.join(", ")}` : "reported nothing"}`);
    }
  }

  const tried = [...byForm.values()].reduce((n, t) => n + t.tried, 0);
  const caught = [...byForm.values()].reduce((n, t) => n + t.caught, 0);
  console.log(`\nspliced     ${tried} made-up paths into ${recovered.length} explanations, ${FORMS.length} forms each${skipped > 0 ? ` (${skipped} skipped: a root-level subject has no folder to make up)` : ""}`);
  for (const [name, t] of byForm) if (t.tried > 0) console.log(`  ${t.caught === t.tried ? "✓" : "✗"} ${name.padEnd(24)}${t.caught}/${t.tried}`);
  if (missed.length > 0) {
    console.log("\nmissed");
    for (const m of missed) console.log(`  ${m}`);
  }
  console.log(`\ncaught      ${caught}/${tried} (${percent(caught, tried)})`);
  return caught === tried ? 0 : 1;
}

/** Made-up neighbours of the subject: guaranteed not among the paths it was shown. */
function makeUp(subject: Subject, shown: readonly string[]): MadeUp {
  const known = new Set(shown);
  const base = subject.kind === "file" ? subject.path : (subject.members[0]?.path ?? `${subject.dir}/index.ts`);
  const dir = path.posix.dirname(base);
  const ext = path.posix.extname(base) || ".ts";
  const stem = path.posix.basename(base, ext);
  let suffix = "legacy";
  for (let i = 2; known.has(join(dir, `${stem}-${suffix}${ext}`)) || known.has(join(dir, suffix)); i++) suffix = `legacy${i}`;
  return {
    file: join(dir, `${stem}-${suffix}${ext}`),
    folder: dir === "." ? null : join(dir, suffix),
    relative: `./${stem}-${suffix}`,
  };
}

const join = (dir: string, name: string) => (dir === "." ? name : `${dir}/${name}`);

/** After the first sentence, so the path sits inside real prose rather than at its edge. */
function insert(body: string, sentence: string): string {
  const end = /[.!?](\s+)/.exec(body);
  if (!end) return `${body} ${sentence}`;
  const at = end.index + 1;
  return `${body.slice(0, at)} ${sentence}${body.slice(at)}`;
}

// ---------------------------------------------------------------------------
// Recovering subjects
// ---------------------------------------------------------------------------

/**
 * Finds the subject behind each cached key by rebuilding candidate subjects
 * from every complete analysis in the same organization. Paths the answer
 * itself names are tried first, since an explanation usually names what it
 * explains; every file and folder node after that, until each key is found.
 */
async function recover(db: Db, cached: readonly Cached[]): Promise<{ recovered: Recovered[]; unmatched: Cached[] }> {
  const recovered: Recovered[] = [];
  const pending = new Map(cached.map((c) => [`${c.orgId}:${c.key}`, c]));
  const orgs = [...new Set(cached.map((c) => c.orgId))];

  for (const orgId of orgs) {
    const { data: analyses, error } = await db
      .from("analyses")
      .select("id, project:projects (repo_owner, repo_name)")
      .eq("org_id", orgId)
      .eq("status", "complete");
    if (error) throw new Error(error.message);

    for (const analysis of analyses ?? []) {
      const waiting = () => [...pending.values()].filter((c) => c.orgId === orgId);
      if (waiting().length === 0) break;
      const repo = analysis.project ? `${analysis.project.repo_owner}/${analysis.project.repo_name}` : analysis.id;
      const files = await paged((from, to) => db.from("files").select("id, path, folder").eq("analysis_id", analysis.id).order("id").range(from, to));
      const filePaths = new Set(files.map((f) => f.path));

      const tryAll = async (kind: "file" | "folder", candidates: readonly string[]) => {
        for (let i = 0; i < candidates.length && waiting().some((c) => c.kind === kind); i += PARALLEL) {
          const subjects = await Promise.all(
            candidates
              .slice(i, i + PARALLEL)
              .map(async (p) => (kind === "file" ? (await loadFileSubject(db, analysis.id, p))?.subject : await loadFolderSubject(db, analysis.id, p)) ?? null),
          );
          for (const subject of subjects) {
            if (!subject) continue;
            const id = `${orgId}:${cacheKey(subject)}`;
            const hit = pending.get(id);
            if (!hit) continue;
            pending.delete(id);
            recovered.push({ ...hit, subject, repo });
          }
        }
      };

      const named = new Set(waiting().flatMap((c) => c.body.match(/[\w@.()[\]+-]+(?:\/[\w@.()[\]+-]+)+/g) ?? []));
      const namedFiles = [...named].filter((p) => filePaths.has(p));
      await tryAll("file", namedFiles);
      await tryAll("file", [...filePaths].filter((p) => !named.has(p)).sort());
      await tryAll(
        "folder",
        fold(files).groups.map((g) => g.dir),
      );
    }
  }
  return { recovered, unmatched: [...pending.values()] };
}

function label(subject: Subject): string {
  return subject.kind === "file" ? subject.path : `${subject.dir}/ (folder)`;
}

function percent(n: number, of: number): string {
  return of === 0 ? "n/a" : `${((n / of) * 100).toFixed(1)}%`;
}
