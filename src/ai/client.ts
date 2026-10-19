import "server-only";

import { createHash } from "node:crypto";
import { ChatGoogle } from "@langchain/google/node";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { getCurrentRunTree, traceable } from "langsmith/traceable";

// The one place a model client is constructed. Everything that asks a model
// anything goes through generateText or generateObject below, inside a run
// started with traced(), so every answer can be followed back to its inputs
// in LangSmith. ESLint refuses the model SDK and langsmith anywhere else, so
// feedback, datasets and experiments go through here too.

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

/**
 * Why a call failed. A rate limit or an overloaded model passes in a
 * minute; the daily quota doesn't, and retrying it only spends time.
 */
export type AiFailure = "rate-limit" | "overloaded" | "daily-quota" | "key" | "model" | "empty" | "config";

/** A failure worth showing as it is: no key, a rate limit, a refusal. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly reason: AiFailure = "config",
    /** How long Google asked us to wait, when it said. */
    readonly retryAfterMs?: number,
    /** Google's own words, kept for logs: the message above is for people. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

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
  if (!text) throw new AiError("The model returned an empty answer.", "empty");
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
      const wait = retryAfter(message);
      // Google doesn't always say "per day"; a wait measured in hours says it instead.
      if (/per.?day/i.test(message) || (wait !== undefined && wait > LONG_WAIT_MS)) {
        throw new AiError(
          `The model's free-tier daily quota is used up${wait !== undefined ? `; Google says it frees up in ${Math.ceil(wait / 3_600_000)} h` : ""}.`,
          "daily-quota",
          wait,
          message,
        );
      }
      throw new AiError("The model's free-tier quota is used up for now. Wait a minute and try again.", "rate-limit", wait, message);
    }
    if (/\b503\b|high demand|overloaded|unavailable/i.test(message)) {
      throw new AiError("Google's model is overloaded right now. Try again in a moment.", "overloaded", undefined, message);
    }
    if (/\b(401|403)\b|api.?key/i.test(message)) throw new AiError("Google refused the API key in GOOGLE_API_KEY.", "key");
    if (/\b404\b|not found/i.test(message)) throw new AiError(`Google doesn't serve the model ${MODEL} to this key.`, "model");
    throw error;
  }
}

/** Past this, a 429 is a quota that's gone for the day, not a rate to wait out. */
const LONG_WAIT_MS = 10 * 60 * 1000;

/**
 * The wait Google asks for, in milliseconds: "Please retry in 37.2s",
 * "retry in 12h27m55.5s", or a retryDelay of "37s".
 */
export function retryAfter(message: string): number | undefined {
  const match = /retry in ((?:\d+h)?(?:\d+m(?!s))?(?:[\d.]+s)?)/i.exec(message) ?? /retryDelay\W+((?:[\d.]+)s)/i.exec(message);
  if (!match?.[1]) return undefined;
  const part = (unit: string) => Number(new RegExp(`([\\d.]+)${unit}`).exec(match[1])?.[1] ?? 0);
  const ms = (part("h(?=\\d|$)") * 3600 + part("m(?=\\d|$)") * 60 + part("s")) * 1000;
  return ms > 0 ? Math.ceil(ms) : undefined;
}

/**
 * Runs `call`, waiting out rate limits (429) and an overloaded model (503)
 * instead of failing on them: Google's own suggested wait when it gives one,
 * otherwise doubling from 15 s. For batch work like experiments, never for a
 * person waiting on the pane. The daily quota isn't retried; nothing short
 * of tomorrow fixes it.
 */
export async function patiently<T>(call: () => Promise<T>, { attempts = 6, label = "model call" } = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const transient = error instanceof AiError && (error.reason === "rate-limit" || error.reason === "overloaded");
      if (!transient || attempt >= attempts) throw error;
      const backoff = 15_000 * 2 ** (attempt - 1);
      const wait = Math.max(backoff, (error.retryAfterMs ?? 0) + 1_000) + Math.floor(Math.random() * 1_000);
      const said = error.detail ? `\n      google: ${error.detail.split("\n")[0].slice(0, 300)}` : "";
      console.warn(`[ai] ${label}: ${error.reason === "rate-limit" ? "rate limited (429)" : "model overloaded (503)"}, waiting ${Math.round(wait / 1000)} s before attempt ${attempt + 1} of ${attempts}${said}`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

// ---------------------------------------------------------------------------
// Feedback on live runs
// ---------------------------------------------------------------------------

/** A score on one run: recorded live as feedback, or returned by an experiment's evaluator. */
export interface Score {
  key: string;
  /** Higher is better. */
  score: number;
  /** LangSmith takes a number, string, boolean or object here, never a bare list. */
  value?: string | number | boolean | Record<string, unknown>;
  comment?: string;
}

const projectIds = new Map<string, Promise<string>>();

/**
 * Attaches `score` to the run in progress as feedback, for checks that run
 * on real traffic. Sent once the run itself has been posted, off the
 * request's path: a person never waits for it, and a failure to record is
 * logged, never thrown. Nothing happens when tracing is off.
 */
export function recordFeedback(score: Score, source: Record<string, unknown> = {}): void {
  const status = tracingStatus();
  const run = getCurrentRunTree(true);
  if (!status.enabled || !run) return;
  const { id, trace_id: traceId, client } = run;
  const projectName = run.project_name ?? status.project ?? "default";
  void (async () => {
    // The run must exist before feedback can point at it.
    await client.awaitPendingTraceBatches();
    let projectId = projectIds.get(projectName);
    if (!projectId) {
      projectId = client.readProject({ projectName }).then((p) => p.id);
      projectIds.set(projectName, projectId);
      projectId.catch(() => projectIds.delete(projectName));
    }
    await client.createFeedback({
      runId: id,
      traceId,
      sessionId: await projectId,
      key: score.key,
      score: score.score,
      value: score.value,
      comment: score.comment,
      sourceInfo: source,
    });
  })().catch((error: unknown) => {
    console.warn(`[ai] couldn't record ${score.key} feedback on run ${id}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

// ---------------------------------------------------------------------------
// Datasets and experiments
// ---------------------------------------------------------------------------

let tracer: Client | undefined;

function langsmith(): Client {
  const status = tracingStatus();
  if (!status.enabled) throw new AiError(`Experiments are recorded in LangSmith, and tracing is off: ${status.reason}.`);
  tracer ??= new Client();
  return tracer;
}

export interface DatasetExample {
  inputs: Record<string, unknown>;
  /** The reference: what a correct answer is, where there is one. */
  outputs: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Uploads `examples` as a LangSmith dataset named after `name` and their
 * content, and returns that name. The same examples always give the same
 * dataset, created once; changed examples give a new one, so an experiment
 * never runs against data that differs from what's on disk.
 */
export async function ensureDataset(name: string, description: string, examples: readonly DatasetExample[]): Promise<string> {
  const client = langsmith();
  const hash = createHash("sha256").update(JSON.stringify(examples)).digest("hex").slice(0, 10);
  const datasetName = `${name}-${hash}`;
  if (await client.hasDataset({ datasetName })) return datasetName;
  const dataset = await client.createDataset(datasetName, { description, metadata: { content_hash: hash } });
  await client.createExamples({
    datasetId: dataset.id,
    inputs: examples.map((e) => e.inputs),
    outputs: examples.map((e) => e.outputs),
    metadata: examples.map((e) => e.metadata ?? {}),
  });
  return datasetName;
}

export type Evaluator = (run: {
  inputs: Record<string, unknown>;
  /** Undefined when the target failed. */
  outputs: Record<string, unknown> | undefined;
  referenceOutputs: Record<string, unknown> | undefined;
}) => Score | Score[] | Promise<Score | Score[]>;

export interface ExperimentRow {
  exampleId: string;
  inputs: Record<string, unknown>;
  referenceOutputs: Record<string, unknown> | undefined;
  outputs: Record<string, unknown> | undefined;
  error: string | undefined;
  scores: Score[];
}

export interface Experiment {
  name: string;
  rows: ExperimentRow[];
}

/**
 * Runs `target` over every example of `dataset` as one LangSmith experiment
 * and scores each run with `evaluators`. `concurrency` bounds the target and
 * the evaluators together: with 1, one model call at a time.
 */
export async function runExperiment(options: {
  dataset: string;
  prefix: string;
  description: string;
  metadata?: Record<string, unknown>;
  target: (inputs: Record<string, unknown>) => Promise<Record<string, unknown>>;
  evaluators: readonly Evaluator[];
  concurrency: number;
}): Promise<Experiment> {
  const client = langsmith();
  const evaluators = options.evaluators.map((evaluator) => {
    // Named after the evaluator, so its runs read as what they check.
    const named = {
      [evaluator.name || "evaluator"]: async (run: { inputs: Record<string, unknown>; outputs?: Record<string, unknown>; referenceOutputs?: Record<string, unknown> }) => {
        const scores = await evaluator({ inputs: run.inputs, outputs: run.outputs, referenceOutputs: run.referenceOutputs });
        return Array.isArray(scores) ? { results: scores } : scores;
      },
    };
    return Object.values(named)[0];
  });
  const results = await evaluate(options.target, {
    data: options.dataset,
    evaluators,
    experimentPrefix: options.prefix,
    description: options.description,
    metadata: { model: MODEL, ...options.metadata },
    maxConcurrency: options.concurrency,
    client,
  });
  return {
    name: results.experimentName,
    rows: results.results.map((row) => ({
      exampleId: row.example.id,
      inputs: row.example.inputs,
      referenceOutputs: row.example.outputs,
      outputs: row.run.outputs,
      error: row.run.error,
      scores: row.evaluationResults.results.map((r) => ({
        key: r.key,
        score: Number(r.score),
        value: r.value as Score["value"],
        comment: r.comment,
      })),
    })),
  };
}

/** The LangSmith page that shows these experiments side by side. */
export async function comparisonUrl(dataset: string, experiments: readonly string[]): Promise<string> {
  const client = langsmith();
  const url = await client.getDatasetUrl({ datasetName: dataset });
  const ids = await Promise.all(experiments.map((projectName) => client.readProject({ projectName }).then((p) => p.id)));
  return `${url}/compare?selectedSessions=${ids.join(",")}`;
}
