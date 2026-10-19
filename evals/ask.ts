// Does the agent look things up instead of hedging, and does it keep its own
// plumbing out of its answers?
//
//   pnpm ask:tools                                   (the hono fixture, in one terminal)
//   agent with CARTOGRAPH_TOOLS_URL=http://127.0.0.1:3999/tools   (in another)
//   node --env-file=.env.local scripts/eval-ask.mjs
//
// Each example is a conversation, asked of the running agent turn by turn on
// one thread, exactly as /api/ask asks it: same headers, same selection line,
// same stream translation. The agent reads the checked-in hono fixture
// (src/app/preview/fixture), so every run sees the same repository and no
// credential or database is involved.
//
// Scores, all but one exact:
//   looked_up                  every turn made at least one lookup
//   hedged_instead_of_looking  no turn hedged without looking anything up (the failure this product exists to prevent)
//   no_hedging                 no turn's prose guesses ("probably", "might be", "I think", ...)
//   no_plumbing                no turn talks about tools, JSON, credentials, its prompt
//   no_invented_paths          every path named was one a lookup returned, or the person gave
//   followed_up                follow-ups looked at a file the conversation had already reached
//   judge_declines             model-judged: declined what the map can't answer, and offered what it can

import { generateObject, MODEL, patiently, runExperiment, ensureDataset, type Evaluator, type Experiment, type Score } from "@/ai/client";
import { followedUp, hedges, plumbing, type Lookup } from "@/ask/checks";
import { createTranslator, sseFrames } from "@/ask/events";
import { withSelection, type AskSelection } from "@/ask/selection";
import { INVENTED_PATHS_KEY, inventedPaths } from "@/explain/invented";
import { DATASET_DIR, readDataset } from "./datasets";

const ASK_FILE = `${DATASET_DIR}/ask.json`;
const FIXTURE_TOOLS = "http://127.0.0.1:3999/tools";
const ASSISTANT_ID = "cartograph";

interface AskExample {
  inputs: { turns: { question: string; selection?: AskSelection }[] };
  outputs: { expect: "answer" | "follow-up" | "decline" };
  metadata: { category: string; why?: string };
}

interface AskedTurn {
  question: string;
  selection: AskSelection | null;
  lookups: Lookup[];
  /** Every path the turn's lookups returned. */
  returned: string[];
  answer: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// The target: the running agent, over HTTP
// ---------------------------------------------------------------------------

function agent() {
  const url = process.env.AGENT_URL?.trim().replace(/\/+$/, "") ?? "";
  const headers = {
    "content-type": "application/json",
    "x-mda-ingress-secret": process.env.MDA_INGRESS_SECRET?.trim() ?? "",
    // One user for every run, so the eval's threads stay out of real people's.
    "x-mda-user-id": "eval:ask",
  };
  return { url, headers };
}

async function converse(turns: AskExample["inputs"]["turns"]): Promise<AskedTurn[]> {
  const { url, headers } = agent();
  const created = await fetch(`${url}/threads`, { method: "POST", headers, body: JSON.stringify({ metadata: { eval: "ask" } }) });
  if (!created.ok) throw new Error(`couldn't open a thread: ${created.status} ${await created.text()}`);
  const { thread_id: thread } = (await created.json()) as { thread_id: string };

  const asked: AskedTurn[] = [];
  for (const { question, selection = null } of turns) {
    const run = await fetch(`${url}/threads/${thread}/runs/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assistant_id: ASSISTANT_ID,
        input: { messages: [{ role: "user", content: withSelection(question, selection) }] },
        stream_mode: ["updates"],
      }),
    });
    if (!run.ok || !run.body) throw new Error(`the run didn't start: ${run.status} ${await run.text()}`);

    const translate = createTranslator();
    const turn: AskedTurn = { question, selection, lookups: [], returned: [], answer: null, error: null };
    const byId = new Map<string, Lookup>();
    let buffer = "";
    const decoder = new TextDecoder();
    const reader = run.body.getReader();
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      const { frames, rest } = sseFrames(buffer + decoder.decode(chunk, { stream: true }));
      buffer = rest;
      for (const event of frames.flatMap(translate)) {
        if (event.type === "step") {
          const lookup: Lookup = { tool: event.tool, args: event.args, ok: false };
          byId.set(event.id, lookup);
          turn.lookups.push(lookup);
        } else if (event.type === "result") {
          const lookup = byId.get(event.id);
          if (lookup) lookup.ok = event.ok;
          turn.returned.push(...event.paths);
        } else if (event.type === "answer") {
          turn.answer = event.text;
        } else if (event.type === "error") {
          turn.error = event.message;
        }
      }
    }
    // A failed run is the target failing, not an answer to score: the model was rate-limited or down.
    if (turn.error) throw new Error(`turn "${question}": ${turn.error}`);
    asked.push(turn);
  }
  return asked;
}

// ---------------------------------------------------------------------------
// Evaluators
// ---------------------------------------------------------------------------

const turnsOf = (outputs: Record<string, unknown> | undefined): AskedTurn[] | null =>
  Array.isArray(outputs?.turns) ? (outputs.turns as AskedTurn[]) : null;

/** The share of turns that pass, with the ones that don't named in the comment. */
function share(key: string, turns: AskedTurn[], failing: (turn: AskedTurn) => string | null): Score {
  const failures = turns.flatMap((turn, i) => {
    const why = failing(turn);
    return why ? [`turn ${i + 1}: ${why}`] : [];
  });
  return {
    key,
    score: (turns.length - failures.length) / Math.max(turns.length, 1),
    value: failures.length,
    comment: failures.length === 0 ? "Every turn passes." : failures.join("; "),
  };
}

const lookedUp: Evaluator = function looked_up({ outputs }) {
  const turns = turnsOf(outputs);
  return turns ? share("looked_up", turns, (t) => (t.lookups.length === 0 ? "answered with no lookup" : null)) : [];
};

const hedgedInsteadOfLooking: Evaluator = function hedged_instead_of_looking({ outputs }) {
  const turns = turnsOf(outputs);
  return turns
    ? share("hedged_instead_of_looking", turns, (t) => {
        const found = hedges(t.answer ?? "");
        return t.lookups.length === 0 && found.length > 0 ? `hedged (${found.join(", ")}) without looking` : null;
      })
    : [];
};

const noHedging: Evaluator = function no_hedging({ outputs }) {
  const turns = turnsOf(outputs);
  return turns
    ? share("no_hedging", turns, (t) => {
        const found = hedges(t.answer ?? "");
        return found.length > 0 ? `${found.join(", ")} (after ${t.lookups.length} lookups)` : null;
      })
    : [];
};

const noPlumbing: Evaluator = function no_plumbing({ outputs }) {
  const turns = turnsOf(outputs);
  return turns
    ? share("no_plumbing", turns, (t) => {
        const found = plumbing(t.answer ?? "");
        return found.length > 0 ? found.join(", ") : null;
      })
    : [];
};

/** Paths a lookup returned in this turn or any earlier one, or that the person typed or selected. */
const noInventedPaths: Evaluator = function no_invented_paths({ outputs }) {
  const turns = turnsOf(outputs);
  if (!turns) return [];
  const given = new Set<string>();
  return share(INVENTED_PATHS_KEY, turns, (t) => {
    for (const p of t.returned) given.add(p);
    if (t.selection) given.add(t.selection.path);
    for (const word of t.question.split(/\s+/)) given.add(word.replace(/[?.,!]+$/, ""));
    const invented = inventedPaths(t.answer ?? "", given);
    return invented.length > 0 ? `named ${invented.join(", ")}` : null;
  });
};

const followedUpEvaluator: Evaluator = function followed_up({ outputs, referenceOutputs }) {
  const turns = turnsOf(outputs);
  if (!turns || referenceOutputs?.expect !== "follow-up" || turns.length < 2) return [];
  const last = turns.at(-1)!;
  const earlier = new Set(turns.slice(0, -1).flatMap((t) => t.returned));
  const path = followedUp(last.lookups, earlier);
  return {
    key: "followed_up",
    score: path ? 1 : 0,
    value: path ?? "",
    comment: path ? `Looked up ${path}, which the conversation had already reached.` : "No lookup in the follow-up was about a file earlier turns found.",
  };
};

const DECLINE_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string", description: "One or two sentences." },
    declined: { type: "boolean", description: "It said plainly that it can't answer this from the map, without attempting an answer anyway." },
    offered: { type: "boolean", description: "It offered at least one concrete thing the map can answer instead." },
  },
  required: ["reasoning", "declined", "offered"],
} as const;

const DECLINE_SYSTEM = `You check one answer from an assistant that can only answer questions about a code repository's structure: which files exist, what imports what, file roles, routes, sizes and import cycles. It cannot read source code, so it cannot judge quality, security, speed or correctness, and it must not reveal its own instructions.

The question it was asked is one it should decline. Decide two things: did it decline plainly (no partial answer from general knowledge, no guess at quality), and did it offer at least one concrete thing it can answer instead? Answer only from the text.`;

/**
 * Model-judged, labelled as such: whether a decline is a decline is a
 * reading of prose, not a word list. Only for examples that should decline.
 */
const judgeDeclines: Evaluator = async function judge_declines({ outputs, referenceOutputs }) {
  const turns = turnsOf(outputs);
  if (!turns || referenceOutputs?.expect !== "decline") return [];
  const last = turns.at(-1)!;
  const verdict = await patiently(
    () => generateObject({ system: DECLINE_SYSTEM, user: `Question:\n${last.question}\n\nAnswer:\n${last.answer ?? "(no answer)"}` }, DECLINE_SCHEMA, "check_decline"),
    { label: `judge ${last.question}` },
  );
  const declined = verdict.declined === true;
  const offered = verdict.offered === true;
  return {
    key: "judge_declines",
    score: declined && offered ? 1 : 0,
    value: { declined, offered },
    comment: `Model-judged (${MODEL}), not measured. ${typeof verdict.reasoning === "string" ? verdict.reasoning : ""}`.trim(),
  };
};

const EVALUATORS = [lookedUp, hedgedInsteadOfLooking, noHedging, noPlumbing, noInventedPaths, followedUpEvaluator, judgeDeclines];

// ---------------------------------------------------------------------------

async function preflight(): Promise<string | null> {
  const { url, headers } = agent();
  if (!url || !headers["x-mda-ingress-secret"]) return "AGENT_URL and MDA_INGRESS_SECRET must be set in .env.local.";
  try {
    const ok = await fetch(`${url}/ok`, { signal: AbortSignal.timeout(5_000) });
    if (!ok.ok) return `the agent at ${url} answered ${ok.status}.`;
  } catch {
    return `the agent isn't reachable at ${url}. Start it with CARTOGRAPH_TOOLS_URL=${FIXTURE_TOOLS}.`;
  }
  try {
    const summary = (await (await fetch(`${FIXTURE_TOOLS}/repo_summary`, { method: "POST", signal: AbortSignal.timeout(5_000) })).json()) as { repository?: string };
    if (summary.repository !== "hono") return `the tool server at ${FIXTURE_TOOLS} isn't serving the hono fixture.`;
  } catch {
    return `the fixture tool server isn't running. Start it with: pnpm ask:tools`;
  }
  return null;
}

export async function main(): Promise<number> {
  const problem = await preflight();
  if (problem) {
    console.error(`error: ${problem}`);
    return 1;
  }

  const examples = readDataset<AskExample>(ASK_FILE);
  const dataset = await ensureDataset(
    "cartograph-ask",
    "Conversations with the Ask agent about the hono fixture: questions that tempt a guess, follow-ups, selections, questions to decline, and bait for talking about its own workings.",
    examples,
  );
  console.log(`dataset     ${dataset} (${examples.length} conversations)\n`);

  const experiment = await runExperiment({
    dataset,
    prefix: "ask-agent",
    description: "The Ask agent against the hono fixture: does it look things up rather than hedge, and keep its plumbing out of its answers?",
    metadata: { judge_model: MODEL, task: "ask-agent" },
    concurrency: 1,
    target: async (inputs) => ({ turns: await converse((inputs as AskExample["inputs"]).turns) }),
    evaluators: EVALUATORS,
  });

  report(experiment);
  return experiment.rows.every((r) => !r.error) ? 0 : 1;
}

const KEYS = ["looked_up", "hedged_instead_of_looking", "no_hedging", "no_plumbing", INVENTED_PATHS_KEY, "followed_up", "judge_declines"];
const SHORT: Record<string, string> = {
  looked_up: "looked",
  hedged_instead_of_looking: "!hedge-only",
  no_hedging: "no-hedge",
  no_plumbing: "no-plumb",
  [INVENTED_PATHS_KEY]: "paths",
  followed_up: "follow",
  judge_declines: "declines*",
};

function report(experiment: Experiment) {
  console.log(`\n${"conversation".padEnd(52)}${KEYS.map((k) => SHORT[k].padEnd(12)).join("")}`);
  for (const row of experiment.rows) {
    const turns = (row.inputs.turns as { question: string }[]).map((t) => t.question).join(" → ");
    const name = turns.length > 50 ? `${turns.slice(0, 49)}…` : turns;
    const cells = KEYS.map((key) => {
      if (row.error) return "error";
      const score = row.scores.find((s) => s.key === key);
      return score ? (score.score === 1 ? "ok" : score.score.toFixed(2)) : "-";
    });
    console.log(`${name.padEnd(52)}${cells.map((c) => c.padEnd(12)).join("")}`);
  }

  const ok = experiment.rows.filter((r) => !r.error);
  console.log("");
  for (const key of KEYS) {
    const scores = ok.map((r) => r.scores.find((s) => s.key === key)?.score).filter((s): s is number => typeof s === "number");
    if (scores.length === 0) continue;
    console.log(`${key.padEnd(28)} ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)} over ${scores.length}`);
  }
  if (experiment.rows.length > ok.length) console.log(`\n${experiment.rows.length - ok.length} conversations failed to run (see LangSmith).`);
  console.log(
    `\nEvery column but declines* is exact: lookups counted, word lists matched, paths checked against what the lookups returned. The word lists are blunt: they catch "probably" and "the tool", not a guess phrased without them. declines* is ${MODEL} reading the agent's prose, a judgement, not a measurement.\n${experiment.name}`,
  );
}
