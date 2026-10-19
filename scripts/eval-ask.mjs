// The Ask agent over the conversations in evals/datasets/ask.json: does it
// look things up rather than hedge, and keep its plumbing out of its answers?
// Needs the fixture tool server and the agent running; see evals/ask.ts.
//
//   node --env-file=.env.local scripts/eval-ask.mjs

import { requireEnv, run } from "./boot.mjs";

requireEnv("GOOGLE_API_KEY", "LANGSMITH_API_KEY", "LANGSMITH_TRACING", "AGENT_URL", "MDA_INGRESS_SECRET");
run(import("../evals/ask.ts"));
