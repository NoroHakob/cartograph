// Builds the eval datasets in evals/datasets from real parses. No model calls.
//
//   node --env-file=.env.local scripts/eval-build.mjs

import { requireEnv, run } from "./boot.mjs";

requireEnv();
run(import("../evals/build.ts"));
