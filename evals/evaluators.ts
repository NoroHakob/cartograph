// What the experiments score with. The invented-path check is the app's own
// function, deterministic. The judge is a model, unavoidably, and is labelled
// as one wherever its number appears.

import { generateObject, MODEL, patiently, type Evaluator, type Score } from "@/ai/client";
import { INVENTED_PATHS_KEY, inventedPaths } from "@/explain/invented";
import { filePrompt, type FileSubject } from "@/explain/prompts";

/**
 * One call at a time, target and evaluators together. The free tier allows a
 * handful of requests a minute, and parallel calls only collect 429s faster.
 */
export const CONCURRENCY = 1;

/** Targets return the explanation and the exact paths that version showed the model. */
export interface Explained {
  explanation: string;
  shown: string[];
}

const isExplained = (outputs: Record<string, unknown> | undefined): outputs is Record<string, unknown> & Explained =>
  typeof outputs?.explanation === "string" && Array.isArray(outputs.shown);

/** Set membership against what that prompt showed. No model involved. */
export const inventedPathsEvaluator: Evaluator = function invented_paths({ outputs }) {
  if (!isExplained(outputs)) return [];
  const invented = inventedPaths(outputs.explanation, outputs.shown);
  return {
    key: INVENTED_PATHS_KEY,
    score: invented.length === 0 ? 1 : 0,
    value: invented.length,
    comment: invented.length === 0 ? "Every path it named was one it was shown." : `Named paths it wasn't shown: ${invented.join(", ")}`,
  };
};

export const JUDGE_KEY = "judge_specificity";

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string", description: "Two or three sentences: what in the explanation is specific to this file, and what is generic or wrong." },
    score: { type: "integer", minimum: 1, maximum: 5, description: "The grade, 1 to 5, by the rubric." },
  },
  required: ["reasoning", "score"],
} as const;

const JUDGE_SYSTEM = `You grade one explanation of one source file. The reader is a developer looking at a dependency map who has just selected this file and wants to know what it is for.

Grade a single thing: is the explanation specific enough to be useful to that reader? Use the file's source and its neighbour lists, given below, as the facts.

5: Says what this file in particular does, names the concrete things in it (functions, classes, exported values) and what its actual neighbours use it for or give it. Nothing in it is wrong.
4: Specific and correct, but misses something a reader would want, or spends words on the obvious.
3: Partly specific. Some sentences could describe any file of this kind.
2: Mostly generic, or specific but with a claim the facts contradict.
1: Generic throughout, or materially wrong about the file or its connections.

A claim about a connection that the neighbour lists don't show counts as wrong. Length is not a virtue: a longer answer scores higher only if the extra words carry facts about this file. Ignore formatting.`;

/**
 * A model grading a model: gemini grades gemini's answers, on a question
 * with no exact answer. Useful for a direction between two prompts on the
 * same examples, not as a measurement. It sees the explanation and the facts,
 * never which prompt produced it.
 */
export const judgeEvaluator: Evaluator = async function judge_specificity({ inputs, outputs }) {
  if (!isExplained(outputs)) return [];
  const subject = inputs.subject as FileSubject;
  const source = typeof inputs.source === "string" ? inputs.source : null;
  const facts = filePrompt(subject, source).user;
  const verdict = await patiently(
    () =>
      generateObject(
        { system: JUDGE_SYSTEM, user: `${facts}\n\nThe explanation to grade:\n<explanation>\n${outputs.explanation}\n</explanation>` },
        JUDGE_SCHEMA,
        "grade_explanation",
      ),
    { label: `judge ${subject.path}` },
  );
  const grade = Number(verdict.score);
  if (!Number.isInteger(grade) || grade < 1 || grade > 5) throw new Error(`the judge answered ${JSON.stringify(verdict.score)}, not a grade from 1 to 5`);
  const score: Score = {
    key: JUDGE_KEY,
    // 1..5 onto 0..1, so it averages like the other scores.
    score: (grade - 1) / 4,
    value: grade,
    comment: `Model-judged (${MODEL}), not measured. ${typeof verdict.reasoning === "string" ? verdict.reasoning : ""}`.trim(),
  };
  return score;
};
