// Builds evals/datasets/*.json from real parses of public repositories.
//
//   node --env-file=.env.local scripts/eval-build.mjs
//
// Every subject is made from the parser's own output (files, roles, edges),
// the same way the app makes one from the stored rows, and every source is
// the file's bytes at a pinned commit. No model is called.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifies, MAX_SOURCE_CHARS, type FileSubject, type Neighbour } from "@/explain/prompts";
import { CLASSIFIABLE_ROLES, isClassifiableRole, type ClassifiableRole } from "@/parser/taxonomy";
import type { ParseResult } from "@/parser/types";
import { downloadArchive, FETCH_TIMEOUT_MS, parseRepoUrl, resolveSnapshot } from "@/pipeline/github";
import { parseHere } from "@/pipeline/parse-here";
import { selectFromArchive } from "@/pipeline/select";
import { DATASET_DIR, EXPLAIN_FILE, ROLES_FILE, type ExplainExample, type Origin, type RoleExample } from "./datasets";

/**
 * Chosen so that between them, convention assigns every classifiable role
 * except util, which no adapter ever assigns: services and repositories
 * (NestJS), services, models and config (Express), components (Next.js), and
 * hooks named useX (React).
 */
const REPOS = ["brocoders/nestjs-boilerplate", "hagopj13/node-express-boilerplate", "alan2207/bulletproof-react", "jgudo/ecommerce-react"];

/**
 * About ten files, spread over the roles. Free-tier quota is the limit: each
 * example is one model call per experiment.
 */
const ROLE_QUOTA: Record<ClassifiableRole, number> = { service: 2, repository: 2, model: 2, util: 0, config: 1, component: 2, hook: 1 };

/** Explain examples per repository: identified files, then ones no adapter matched. */
const EXPLAIN_IDENTIFIED = 2;
const EXPLAIN_UNIDENTIFIED = 1;
/**
 * Taken from the repositories in turn, so each contributes. Five because the
 * free tier gives gemini-3.8-flash 20 requests a day, and the prompt
 * comparison spends four per file (an answer and a grade, for each of two
 * prompts): five files is one day's quota.
 */
const EXPLAIN_TOTAL = 5;

interface Parsed {
  origin: Origin;
  result: ParseResult;
  sources: Map<string, string>;
}

export async function main(): Promise<number> {
  const parsed: Parsed[] = [];
  for (const repo of REPOS) parsed.push(await parse(repo));

  // A file name is used once across both datasets: two copies of the same
  // file in different apps of a monorepo are one example, not two.
  const used = new Set<string>();
  const roles = roleExamples(parsed, used);
  const explain = explainExamples(parsed, used);

  mkdirSync(DATASET_DIR, { recursive: true });
  writeFileSync(ROLES_FILE, `${JSON.stringify(roles, null, 2)}\n`);
  writeFileSync(EXPLAIN_FILE, `${JSON.stringify(explain, null, 2)}\n`);

  console.log(`\nroles.json    ${roles.length} files`);
  for (const e of roles) console.log(`  ${e.outputs.role.padEnd(11)}${e.inputs.origin.repo}  ${e.inputs.subject.path}`);
  console.log(`explain.json  ${explain.length} files`);
  for (const e of explain) {
    const s = e.inputs.subject;
    console.log(`  ${(classifies(s) ? "unidentified" : s.role).padEnd(17)}${e.inputs.origin.repo}  ${s.path}  (${s.imports.length} out, ${s.importedBy.length} in)`);
  }
  return 0;
}

async function parse(input: string): Promise<Parsed> {
  const ref = parseRepoUrl(input);
  if (!ref) throw new Error(`not a repository: ${input}`);
  const workdir = mkdtempSync(path.join(tmpdir(), "cartograph-eval-"));
  try {
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const snapshot = await resolveSnapshot(ref, signal);
    const archive = path.join(workdir, "archive.tar.gz");
    await downloadArchive(snapshot, archive, signal);
    const root = path.join(workdir, "repo", snapshot.name);
    mkdirSync(root, { recursive: true });
    await selectFromArchive(archive, root);
    const { result, problems } = parseHere(root);
    if (problems.length > 0) throw new Error(`${input}: parser invariants broken: ${problems[0]}`);
    const sources = new Map(result.files.map((f) => [f.path, readFileSync(path.join(root, f.path), "utf8")]));
    const counts = new Map<string, number>();
    for (const f of result.files) counts.set(f.role, (counts.get(f.role) ?? 0) + 1);
    console.log(
      `${snapshot.owner}/${snapshot.name}@${snapshot.commitSha.slice(0, 7)}  ${result.adapter.name}, ${result.files.length} files: ${[...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([r, n]) => `${r} ${n}`)
        .join(", ")}`,
    );
    return { origin: { repo: `${snapshot.owner}/${snapshot.name}`, commit: snapshot.commitSha, framework: result.adapter.id }, result, sources };
  } finally {
    rmSync(workdir, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** A file and its neighbours from the parse, as subject.ts builds one from stored rows. */
function subjectOf(result: ParseResult, filePath: string): FileSubject {
  const files = new Map(result.files.map((f) => [f.path, f]));
  const file = files.get(filePath)!;
  const neighbour = (other: string, typeOnly: boolean): Neighbour => ({ path: other, role: files.get(other)!.role, typeOnly });
  const byPath = (a: Neighbour, b: Neighbour) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {
    kind: "file",
    path: file.path,
    language: file.language,
    lineCount: file.lineCount,
    hash: file.hash,
    role: file.role,
    imports: result.edges.filter((e) => e.source === filePath).map((e) => neighbour(e.target, e.typeOnly)).sort(byPath),
    importedBy: result.edges.filter((e) => e.target === filePath).map((e) => neighbour(e.source, e.typeOnly)).sort(byPath),
  };
}

/**
 * Files worth asking about: not tests, not barrels (an index file's role
 * comes from its folder alone, and it has nothing in it to explain), short
 * enough to be sent whole, with something on the map around them. Most
 * connected first, then by path, so the same parse always gives the same picks.
 */
function candidates(p: Parsed, keep: (role: string) => boolean): { path: string; links: number }[] {
  return p.result.files
    .filter((f) => keep(f.role) && f.role !== "test" && f.fanIn + f.fanOut > 0)
    .filter((f) => !/^index\.[cm]?[jt]sx?$/.test(path.posix.basename(f.path)))
    .filter((f) => (p.sources.get(f.path) ?? "").length <= MAX_SOURCE_CHARS)
    .map((f) => ({ path: f.path, links: f.fanIn + f.fanOut }))
    .sort((a, b) => b.links - a.links || (a.path < b.path ? -1 : 1));
}

const basename = (file: string) => path.posix.basename(file);

function roleExamples(parsed: Parsed[], used: Set<string>): RoleExample[] {
  const out: RoleExample[] = [];
  for (const role of CLASSIFIABLE_ROLES) {
    // Round-robin over the repositories that have this role, so two services
    // aren't both from the same codebase when another has one.
    const queues = parsed.map((p) => ({ p, files: candidates(p, (r) => r === role) })).filter((q) => q.files.length > 0);
    for (let taken = 0, i = 0; taken < ROLE_QUOTA[role] && queues.some((q) => q.files.length > 0); i++) {
      const q = queues[i % queues.length];
      const next = q.files.shift();
      if (!next || used.has(basename(next.path))) continue;
      const subject = subjectOf(q.p.result, next.path);
      if (!isClassifiableRole(subject.role)) continue;
      out.push({
        // Hidden: the model sees what it sees for a file no adapter matched.
        inputs: { origin: q.p.origin, subject: { ...subject, role: "other" }, source: q.p.sources.get(next.path)! },
        outputs: { role: subject.role },
      });
      used.add(basename(next.path));
      taken++;
    }
    if (ROLE_QUOTA[role] > 0 && !out.some((e) => e.outputs.role === role)) console.warn(`warning: no repository gave a ${role}`);
  }
  return out;
}

function explainExamples(parsed: Parsed[], used: Set<string>): ExplainExample[] {
  const perRepo = parsed.map((p) => {
    const files = new Map(p.result.files.map((f) => [f.path, f]));
    // Both directions on the map, so there's something to say about each.
    const usable = (c: { path: string }) => !used.has(basename(c.path)) && files.get(c.path)!.fanIn > 0 && files.get(c.path)!.fanOut > 0;
    const identified = candidates(p, (r) => r !== "other" && r !== "source").filter(usable);
    const unidentified = candidates(p, (r) => r === "other" || r === "source").filter(usable);
    // One per role among the identified, for variety.
    const roles = new Set<string>();
    const picks = identified.filter((c) => {
      const role = files.get(c.path)!.role;
      if (roles.has(role)) return false;
      roles.add(role);
      return true;
    });
    // The unidentified file second, so a small total still includes one:
    // that's the case where the shipping prompt also classifies.
    const [first, ...rest] = picks.slice(0, EXPLAIN_IDENTIFIED);
    return [first, ...unidentified.slice(0, EXPLAIN_UNIDENTIFIED), ...rest].filter((c) => c !== undefined).map((c) => ({ p, path: c.path }));
  });

  const out: ExplainExample[] = [];
  for (let i = 0; out.length < EXPLAIN_TOTAL && perRepo.some((q) => q.length > 0); i++) {
    const next = perRepo[i % perRepo.length].shift();
    if (!next || used.has(basename(next.path))) continue;
    used.add(basename(next.path));
    out.push({ inputs: { origin: next.p.origin, subject: subjectOf(next.p.result, next.path), source: next.p.sources.get(next.path)! }, outputs: {} });
  }
  return out;
}
