import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createTranslator, sseFrames, type AskEvent } from "./events";

const human = { type: "human", id: "h1", content: "where is auth?" };
const ask1 = { type: "ai", id: "m1", content: "", tool_calls: [{ id: "c1", name: "find_files", args: { query: "auth" } }] };
const found = {
  type: "tool",
  id: "t1",
  tool_call_id: "c1",
  name: "find_files",
  content: JSON.stringify({ query: "auth", total: 2, files: [{ path: "src/auth/session.ts" }, { path: "src/auth/token.ts" }], omitted: 0 }),
};
const ask2 = { type: "ai", id: "m2", content: "Let me check.", tool_calls: [{ id: "c2", name: "walk", args: { path: "src/x.ts", direction: "dependents" } }] };
const failed = { type: "tool", id: "t2", tool_call_id: "c2", name: "walk", content: JSON.stringify({ error: "No file at \"src/x.ts\".", similarPaths: ["src/auth/session.ts"] }) };
const answer = { type: "ai", id: "m3", content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "It's in `src/auth/session.ts`." }] };

const frame = (event: string, data: unknown) => ({ event, data: JSON.stringify(data) });
// What the agent actually sends: middleware echoes the whole history after every step.
const run = [
  frame("metadata", { run_id: "r" }),
  frame("updates", { "ModelCallLimitMiddleware.before_model": { messages: [human] } }),
  frame("messages", [{ type: "AIMessageChunk", id: "m1", content: "" }, { langgraph_node: "model_request" }]),
  frame("updates", { model_request: { messages: [ask1] } }),
  frame("updates", { "ModelCallLimitMiddleware.after_model": { messages: [human, ask1] } }),
  frame("updates", { tools: { messages: [found] } }),
  frame("messages", [{ type: "AIMessageChunk", id: "m2", content: "Let me check." }, { langgraph_node: "model_request" }]),
  frame("updates", { model_request: { messages: [ask2] } }),
  frame("updates", { tools: { messages: [failed] } }),
  frame("messages", [{ type: "AIMessageChunk", id: "m3", content: [{ type: "text", text: "It's in " }] }, { langgraph_node: "model_request" }]),
  frame("messages", [{ type: "AIMessageChunk", id: "m3", content: [{ type: "text", text: "`src/auth/session.ts`." }] }, { langgraph_node: "model_request" }]),
  frame("updates", { model_request: { messages: [answer] } }),
  frame("updates", { "ModelCallLimitMiddleware.after_agent": { messages: [human, ask1, found, ask2, failed, answer] } }),
  frame("messages", [{ type: "AIMessageChunk", id: "m3", content: "late chunk" }, { langgraph_node: "model_request" }]),
];

describe("ask events", () => {
  const translate = createTranslator();
  const events: AskEvent[] = run.flatMap(translate);

  test("each lookup and answer is sent once, however often the graph repeats it", () => {
    assert.deepEqual(
      events.map((e) => e.type),
      ["step", "result", "text", "step", "result", "text", "text", "answer"],
    );
  });

  test("a lookup's result is summarised from its own numbers, with its paths", () => {
    const result = events[1];
    assert.equal(result.type, "result");
    if (result.type !== "result") return;
    assert.equal(result.ok, true);
    assert.equal(result.summary, "2 files match");
    assert.deepEqual(result.paths, ["src/auth/session.ts", "src/auth/token.ts"]);
  });

  test("a failed lookup says why, without the plumbing prefix", () => {
    const result = events[4];
    assert.deepEqual(result.type === "result" && { ok: result.ok, summary: result.summary }, { ok: false, summary: 'No file at "src/x.ts".' });
  });

  test("the answer is its text parts only; reasoning never shows", () => {
    assert.deepEqual(events.at(-1), { type: "answer", message: "m3", text: "It's in `src/auth/session.ts`." });
  });

  test("an error frame becomes a plain sentence", () => {
    const [error] = createTranslator()(frame("error", { error: "RequestError", message: "You exceeded your current quota" }));
    assert.deepEqual(error, { type: "error", message: "The model's quota is used up for now. Try again later." });
  });

  test("frames split across reads are held until complete", () => {
    const first = sseFrames('event: updates\ndata: {"a":1}\n\nevent: mess');
    assert.deepEqual(first.frames, [{ event: "updates", data: '{"a":1}' }]);
    const second = sseFrames(first.rest + 'ages\r\ndata: [1]\r\n\r\n');
    assert.deepEqual(second, { frames: [{ event: "messages", data: "[1]" }], rest: "" });
  });
});
