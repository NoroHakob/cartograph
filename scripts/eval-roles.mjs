// Role accuracy: the classifier on files convention already identified, role hidden.
//
//   node --env-file=.env.local scripts/eval-roles.mjs

import { requireEnv, run } from "./boot.mjs";

requireEnv("GOOGLE_API_KEY", "LANGSMITH_API_KEY", "LANGSMITH_TRACING");
run(import("../evals/roles.ts"));
