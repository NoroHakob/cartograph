// The invented-path check over every cached explanation. No model calls.
// --splice writes a made-up path into each one and reports how many it caught.
//
//   node --env-file=.env.local scripts/eval-paths.mjs [--splice]

import { requireEnv, run } from "./boot.mjs";

requireEnv("SUPABASE_SECRET_KEY");
run(import("../evals/paths.ts"));
