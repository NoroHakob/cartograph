// Prompt versions, side by side.
//
//   node --env-file=.env.local scripts/eval-prompts.mjs
//
// The shipping explanation prompt and the retired one (a reconstruction, see
// ./retired/explain-v0.ts) run over the same dataset as two experiments.
// Each answer is scored twice: the invented-path check, which is exact, and a
// model judge on specificity, which isn't.

import { comparisonUrl, ensureDataset, generateText, MODEL, patiently, runExperiment, type Experiment } from "@/ai/client";
import { askAboutFile } from "@/explain/ask";
import { INVENTED_PATHS_KEY } from "@/explain/invented";
import { handedPaths, PROMPT_VERSION, type FileSubject } from "@/explain/prompts";
import { EXPLAIN_FILE, readDataset, type ExplainExample } from "./datasets";
import { CONCURRENCY, inventedPathsEvaluator, JUDGE_KEY, judgeEvaluator, type Explained } from "./evaluators";
import * as retired from "./retired/explain-v0";

interface Version {
  id: string;
  description: string;
  explain: (subject: FileSubject, source: string) => Promise<Explained>;
}

const VERSIONS: Version[] = [
  {
    id: `v${retired.RETIRED_PROMPT_VERSION}-reconstructed`,
    description: "Reconstructed baseline: same inputs, no grounding rules, no formatting subset, no length limit. Never shipped.",
    explain: async (subject, source) => ({
      explanation: await generateText(retired.filePrompt(subject, source)),
      shown: retired.shownPaths(subject),
    }),
  },
  {
    id: `v${PROMPT_VERSION}`,
    description: "The shipping explanation prompt, through the app's own askAboutFile.",
    explain: async (subject, source) => ({ explanation: (await askAboutFile(subject, source)).body, shown: handedPaths(subject) }),
  },
];

export async function main(): Promise<number> {
  const examples = readDataset<ExplainExample>(EXPLAIN_FILE);
  const dataset = await ensureDataset("cartograph-explain", "Files to explain with their real roles and neighbours, from parses of public repositories. No reference answers.", examples);
  console.log(`dataset     ${dataset} (${examples.length} files)\n`);

  const experiments: { version: Version; experiment: Experiment }[] = [];
  for (const version of VERSIONS) {
    const experiment = await runExperiment({
      dataset,
      prefix: `explain-${version.id}`,
      description: version.description,
      metadata: { prompt_version: version.id, judge_model: MODEL, task: "prompt-versions" },
      concurrency: CONCURRENCY,
      target: async (inputs) => {
        const subject = inputs.subject as FileSubject;
        const out = await patiently(() => version.explain(subject, inputs.source as string), { label: `${version.id} ${subject.path}` });
        return { ...out };
      },
      evaluators: [inventedPathsEvaluator, judgeEvaluator],
    });
    experiments.push({ version, experiment });
  }

  report(experiments);
  try {
    console.log(`\nside by side  ${await comparisonUrl(dataset, experiments.map((e) => e.experiment.name))}`);
  } catch (error) {
    console.warn(`(couldn't build the comparison link: ${error instanceof Error ? error.message : String(error)})`);
  }
  return experiments.every((e) => e.experiment.rows.every((r) => !r.error)) ? 0 : 1;
}

function report(experiments: { version: Version; experiment: Experiment }[]) {
  const cell = (rows: Experiment["rows"], exampleId: string) => {
    const row = rows.find((r) => r.exampleId === exampleId);
    if (!row || row.error) return { paths: "error", judge: "error" };
    const invented = row.scores.find((s) => s.key === INVENTED_PATHS_KEY);
    const judge = row.scores.find((s) => s.key === JUDGE_KEY);
    return {
      paths: invented ? (invented.score === 1 ? "clean" : `${invented.value} invented`) : "-",
      judge: judge ? `${judge.value}/5` : "-",
    };
  };

  const [first] = experiments;
  console.log(`\n${"file".padEnd(58)}${experiments.map((e) => `${e.version.id.padEnd(30)}`).join("")}`);
  console.log(`${"".padEnd(58)}${experiments.map(() => `${"paths".padEnd(14)}${"judge".padEnd(16)}`).join("")}`);
  for (const row of first.experiment.rows) {
    const name = (row.inputs.subject as FileSubject).path;
    const short = name.length > 56 ? `…${name.slice(-55)}` : name;
    console.log(`${short.padEnd(58)}${experiments.map((e) => { const c = cell(e.experiment.rows, row.exampleId); return `${c.paths.padEnd(14)}${c.judge.padEnd(16)}`; }).join("")}`);
  }

  console.log("");
  for (const { version, experiment } of experiments) {
    const ok = experiment.rows.filter((r) => !r.error);
    const mean = (key: string) => {
      const scores = ok.map((r) => r.scores.find((s) => s.key === key)?.score).filter((s): s is number => typeof s === "number");
      return { n: scores.length, mean: scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1) };
    };
    const paths = mean(INVENTED_PATHS_KEY);
    const judged = ok.map((r) => Number(r.scores.find((s) => s.key === JUDGE_KEY)?.value)).filter(Number.isFinite);
    const avgGrade = judged.reduce((a, b) => a + b, 0) / Math.max(judged.length, 1);
    console.log(
      `${version.id.padEnd(18)} no invented paths ${Math.round(paths.mean * paths.n)}/${paths.n}   judge ${avgGrade.toFixed(2)}/5 over ${judged.length}${experiment.rows.length > ok.length ? `   (${experiment.rows.length - ok.length} failed)` : ""}   ${experiment.name}`,
    );
  }
  console.log(
    `\nThe paths column is exact: set membership against the paths each prompt showed. The judge column is not a measurement. It is ${MODEL} grading ${MODEL}'s answers on "specific enough to be useful", a question with no exact answer, over ${first.experiment.rows.length} files. Same-model grading can favour its own style, and a difference of a few tenths here is within what rerunning the judge can change. Read it as a direction between the two prompts, not a quality figure.`,
  );
}
