// The shipping explanation prompt against the retired one, as two experiments
// over the same dataset, scored by the invented-path check and a model judge.
//
//   node --env-file=.env.local scripts/eval-prompts.mjs

import { requireEnv, run } from "./boot.mjs";

requireEnv("GOOGLE_API_KEY", "LANGSMITH_API_KEY", "LANGSMITH_TRACING");
run(import("../evals/prompts.ts"));
