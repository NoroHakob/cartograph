import { ChatGoogle } from "@langchain/google/node";

import { ScriptedModel } from "./scripted-model";

// The agent runs as its own service, so it can't import the app's wrapped
// client (src/ai/client.ts). This is its one model, configured to match:
// the same pinned model, temperature and thinking level. No grounding or
// search tool is ever attached; the only tools are the map lookups.

/** Pinned exactly, like the app's MODEL. */
export const MODEL = "gemini-3.8-flash";

// The key is read from GOOGLE_API_KEY by the client itself. Two retries ride
// out a dropped connection without burning free-tier quota on a rate limit.
// CARTOGRAPH_MODEL=scripted swaps in a fixed script for testing the plumbing
// without Gemini; see scripted-model.ts.
export const model =
  process.env.CARTOGRAPH_MODEL === "scripted"
    ? new ScriptedModel({})
    : new ChatGoogle({ model: MODEL, maxRetries: 2, temperature: 0.2, thinkingLevel: "low" });
