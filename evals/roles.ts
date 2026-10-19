// Role accuracy.
//
//   node --env-file=.env.local scripts/eval-roles.mjs
//
// Convention identifies some files for certain, and those never reach the
// classifier in normal operation, so they are a held-out set with real
// ground truth. Each one goes to the app's own classifier as if no adapter
// had matched it, and the role it answers is compared with convention's.

import { ensureDataset, MODEL, patiently, runExperiment, type Evaluator } from "@/ai/client";
import { askAboutFile } from "@/explain/ask";
import { classifies, handedPaths, PROMPT_VERSION, type FileSubject } from "@/explain/prompts";
import { CLASSIFIABLE_ROLES, isClassifiableRole } from "@/parser/taxonomy";
import { readDataset, ROLES_FILE, type RoleExample } from "./datasets";
import { CONCURRENCY, inventedPathsEvaluator } from "./evaluators";

const roleCorrect: Evaluator = function role_correct({ outputs, referenceOutputs }) {
  if (!outputs || typeof referenceOutputs?.role !== "string") return [];
  const answered = typeof outputs.role === "string" ? outputs.role : null;
  return {
    key: "role_correct",
    score: answered === referenceOutputs.role ? 1 : 0,
    value: answered ?? "(no valid role)",
    comment: `Convention says ${referenceOutputs.role}; the classifier said ${answered ?? "nothing valid"}.`,
  };
};

export async function main(): Promise<number> {
  const examples = readDataset<RoleExample>(ROLES_FILE);
  // Scoring the classifier on a role it is forbidden to give measures nothing.
  for (const e of examples) {
    if (!isClassifiableRole(e.outputs.role)) throw new Error(`${e.inputs.subject.path}: ${e.outputs.role} isn't a role the classifier may answer`);
    if (!classifies(e.inputs.subject)) throw new Error(`${e.inputs.subject.path}: its role isn't hidden, so the classifier wouldn't be asked`);
  }

  const dataset = await ensureDataset(
    "cartograph-roles",
    `Files convention identified, role hidden; the reference is convention's role. Only roles the classifier may answer: ${CLASSIFIABLE_ROLES.join(", ")}.`,
    examples,
  );
  console.log(`dataset     ${dataset} (${examples.length} files)\n`);

  const experiment = await runExperiment({
    dataset,
    prefix: `roles-v${PROMPT_VERSION}`,
    description: `The shipping classifier (explanation prompt v${PROMPT_VERSION}) on files whose role convention already knows.`,
    metadata: { prompt_version: PROMPT_VERSION, task: "role-accuracy" },
    concurrency: CONCURRENCY,
    target: async (inputs) => {
      const subject = inputs.subject as FileSubject;
      const answer = await patiently(() => askAboutFile(subject, inputs.source as string), { label: subject.path });
      return { role: answer.role, rationale: answer.rationale, explanation: answer.body, shown: handedPaths(subject) };
    },
    evaluators: [roleCorrect, inventedPathsEvaluator],
  });

  console.log(`\nexperiment  ${experiment.name}\n`);
  const rows = experiment.rows.map((row) => {
    const subject = row.inputs.subject as FileSubject;
    const expected = String(row.referenceOutputs?.role);
    const got = row.error ? `error: ${row.error.split("\n")[0]}` : String(row.outputs?.role ?? "(none)");
    return { path: subject.path, expected, got, correct: row.scores.find((s) => s.key === "role_correct")?.score === 1 };
  });
  for (const r of rows) console.log(`  ${r.correct ? "✓" : "✗"} ${r.expected.padEnd(11)} ${r.got.padEnd(11)} ${r.path}`);

  const scored = rows.filter((r) => !r.got.startsWith("error"));
  const correct = scored.filter((r) => r.correct).length;
  console.log(`\nrole accuracy  ${correct}/${scored.length}${scored.length < rows.length ? ` (${rows.length - scored.length} failed to run, not counted)` : ""}  ${MODEL}`);
  const byRole = new Map<string, { n: number; ok: number }>();
  for (const r of scored) {
    const entry = byRole.get(r.expected) ?? { n: 0, ok: 0 };
    entry.n++;
    if (r.correct) entry.ok++;
    byRole.set(r.expected, entry);
  }
  console.log(`  by role: ${[...byRole].map(([role, { n, ok }]) => `${role} ${ok}/${n}`).join(", ")}`);
  console.log(
    "\nRead with care: these files were identified by their names and folders, and the model sees those names too. Files no convention matched have weaker clues, so this is closer to a ceiling than to what unidentified files get.",
  );
  return scored.length === rows.length ? 0 : 1;
}
