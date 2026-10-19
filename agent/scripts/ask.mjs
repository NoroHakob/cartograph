// Usage: MDA_INGRESS_SECRET=... [ASK_CREDENTIAL=...] node scripts/ask.mjs "first question" ["follow-up" ...]
//
// Asks the running agent (default http://localhost:2024) one or more
// questions on a single thread and prints each lookup the moment it's made,
// then the answer. Development only: a stand-in for the chat panel, calling
// the agent the way the app's /api/ask does. ASK_CREDENTIAL is passed as run
// context; without one, lookups against the app's tool surface fail.

const URL_BASE = (process.env.AGENT_URL ?? "http://localhost:2024").replace(/\/+$/, "");
const headers = {
  "content-type": "application/json",
  "x-mda-ingress-secret": process.env.MDA_INGRESS_SECRET ?? "",
  "x-mda-user-id": process.env.ASK_USER_ID ?? "dev",
};
const context = process.env.ASK_CREDENTIAL ? { askCredential: process.env.ASK_CREDENTIAL } : {};

const questions = process.argv.slice(2);
if (questions.length === 0) {
  console.error('Usage: node scripts/ask.mjs "question" ["follow-up" ...]');
  process.exit(1);
}

const thread = await fetch(`${URL_BASE}/threads`, { method: "POST", headers, body: "{}" }).then((r) => r.json());
if (!thread.thread_id) throw new Error(`Couldn't open a thread: ${JSON.stringify(thread)}`);

for (const question of questions) {
  console.log(`\n> ${question}`);
  const started = Date.now();
  const response = await fetch(`${URL_BASE}/threads/${thread.thread_id}/runs/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ assistant_id: "cartograph", input: { messages: [{ role: "user", content: question }] }, context, stream_mode: ["updates"] }),
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);

  let lookups = 0;
  let answer = "";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1];
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      if (!data) continue;
      if (event === "error") console.log(`  ! ${data}`);
      if (event !== "updates") continue;
      for (const update of Object.values(JSON.parse(data) ?? {})) {
        for (const message of update?.messages ?? []) {
          for (const call of message.tool_calls ?? []) {
            lookups++;
            console.log(`  · ${((Date.now() - started) / 1000).toFixed(1)}s  ${call.name}(${JSON.stringify(call.args)})`);
          }
          if (message.type === "ai" && !(message.tool_calls ?? []).length) {
            const text = typeof message.content === "string" ? message.content : message.content.map((p) => p.text ?? "").join("");
            if (text) answer = text;
          }
        }
      }
    }
  }
  console.log(`\n${answer || "(no answer)"}`);
  console.log(`\n  [${lookups} lookup${lookups === 1 ? "" : "s"}, ${((Date.now() - started) / 1000).toFixed(1)}s]`);
}
