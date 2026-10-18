import "server-only";

import { ChatGoogle } from "@langchain/google/node";
import { getCurrentRunTree, traceable } from "langsmith/traceable";

// The one place a model client is constructed. Everything that asks a model
// anything goes through generateText or generateObject below, inside a run
// started with traced(), so every answer can be followed back to its inputs
// in LangSmith. ESLint refuses the model SDK and langsmith anywhere else.

/**
 * Pinned exactly, never to a moving alias like "gemini-flash-latest". It is
 * also part of every cache key, so re-pinning invalidates only its own cache.
 */
export const MODEL = "gemini-3.8-flash";

/**
 * Retries spend free-tier quota and rarely beat a rate limit, so one is
 * enough to ride out a dropped connection.
 */
const MAX_RETRIES = 1;

let chat: ChatGoogle | undefined;

function model(): ChatGoogle {
  if (!process.env.GOOGLE_API_KEY?.trim()) {
    throw new AiError("GOOGLE_API_KEY isn't set in .env.local, so nothing can be explained.");
  }
  // The key is read from GOOGLE_API_KEY by the client itself. No grounding
  // or other tool is ever attached: the model answers from what it's handed.
  chat ??= new ChatGoogle({ model: MODEL, maxRetries: MAX_RETRIES, temperature: 0.2, thinkingLevel: "low" });
  return chat;
}

/** A failure worth showing as it is: no key, a rate limit, a refusal. */
export class AiError extends Error {}

export interface TracingStatus {
  enabled: boolean;
  /** The LangSmith project runs land in, when enabled. */
  project?: string;
  /** Why tracing is off, when it is. */
  reason?: string;
}

/**
 * Whether runs are being sent to LangSmith. When they aren't, every call
 * still runs; the pane says that nothing was recorded.
 */
export function tracingStatus(): TracingStatus {
  const flag = (process.env.LANGSMITH_TRACING ?? process.env.LANGCHAIN_TRACING_V2 ?? "").trim().toLowerCase();
  if (flag !== "true" && flag !== "1") return { enabled: false, reason: "LANGSMITH_TRACING isn't set to true" };
  if (!process.env.LANGSMITH_API_KEY?.trim()) return { enabled: false, reason: "LANGSMITH_API_KEY isn't set" };
  return { enabled: true, project: process.env.LANGSMITH_PROJECT?.trim() || "default" };
}

let warned = false;

/**
 * Wraps `fn` as a traced run named `name`. Model calls made inside it are
 * recorded as its children; a run that makes none (a cache hit) is still
 * recorded, with no model call and no tokens in it.
 */
export function traced<Args extends unknown[], Result>(
  name: string,
  fn: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args: Args) => {
    const status = tracingStatus();
    if (!status.enabled && !warned) {
      warned = true;
      console.warn(`[ai] tracing is off (${status.reason}); model calls still run but aren't recorded`);
    }
    // TraceableFunction's conditional type collapses over a generic `fn`; at
    // runtime it is `fn` with the same arguments and result, plus a run.
    const run = traceable(fn, { name, run_type: "chain", tracingEnabled: status.enabled, metadata: { model: MODEL } }) as unknown as (
      ...args: Args
    ) => Promise<Result>;
    return run(...args);
  };
}

/** Adds metadata to the run in progress, e.g. whether the cache answered. */
export function annotateRun(metadata: Record<string, string | number | boolean>): void {
  const run = getCurrentRunTree(true);
  if (run) run.metadata = { ...run.metadata, ...metadata };
}

export interface Prompt {
  system: string;
  user: string;
}

/** Plain text from the pinned model. */
export async function generateText(prompt: Prompt): Promise<string> {
  const message = await call(() => model().invoke(messages(prompt)));
  const text = message.text.trim();
  if (!text) throw new AiError("The model returned an empty answer.");
  return text;
}

/**
 * An object matching `schema` (JSON Schema), from the pinned model's
 * structured output. Callers still validate what comes back: a schema
 * constrains the model, it doesn't vouch for it.
 */
export async function generateObject(prompt: Prompt, schema: Record<string, unknown>, name: string): Promise<Record<string, unknown>> {
  // withStructuredOutput is typed over any record: the shape is checked by the caller.
  return call(() => model().withStructuredOutput(schema, { name }).invoke(messages(prompt)));
}

function messages({ system, user }: Prompt): [string, string][] {
  return [
    ["system", system],
    ["human", user],
  ];
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AiError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/\b429\b|quota|rate.?limit|resource.?exhausted/i.test(message)) {
      throw new AiError("The model's free-tier quota is used up for now. Wait a minute and try again.");
    }
    if (/\b(401|403)\b|api.?key/i.test(message)) throw new AiError("Google refused the API key in GOOGLE_API_KEY.");
    if (/\b404\b|not found/i.test(message)) throw new AiError(`Google doesn't serve the model ${MODEL} to this key.`);
    throw error;
  }
}
