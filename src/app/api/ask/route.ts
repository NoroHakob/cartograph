import { translateStream } from "@/ask/events";
import { parseSelection, withSelection } from "@/ask/selection";
import { getIdentity } from "@/lib/identity";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Ask: one question about one analysis, answered by the agent service.
//
//   POST /api/ask   { analysisId, message, threadId?, selection? }
//   → 200 application/x-ndjson, one AskEvent per line, header x-thread-id
//   → 400 | 401 | 404 { error } | 503 { error } when the agent isn't reachable
//
// The agent's LangGraph event stream is translated as it arrives (see
// src/ask/events.ts), so the panel shows each lookup the moment it's made and
// never parses the agent's internals.
//
// The signed-in member asks the database for an Ask credential. It mints one
// only for a complete analysis of the member's own organization, so that is
// the ownership check. The credential goes to the agent as run context, which
// its tools forward to the tool surface; the model never sees it, and is
// never told which analysis it is reading.
//
// The agent is a separate service. Everything here fails fast with a 503 when
// it's down, and nothing else in the app depends on it.

const ASSISTANT_ID = "cartograph";
const CONNECT_TIMEOUT_MS = 5_000;
const MAX_MESSAGE_LENGTH = 2_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: unknown) => Response.json(body, { status });
const UNREACHABLE = "The agent isn't reachable right now. The map, blast radius and explanations still work.";

export async function POST(request: Request) {
  const identity = await getIdentity();
  if (!identity) return json(401, { error: "Sign in and pick an organization first." });

  let body: { analysisId?: unknown; message?: unknown; threadId?: unknown; selection?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "The body must be JSON." });
  }
  const { analysisId, threadId } = body;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (typeof analysisId !== "string" || !UUID.test(analysisId)) return json(400, { error: "analysisId must be an analysis id." });
  if (!message || message.length > MAX_MESSAGE_LENGTH) return json(400, { error: `message must be 1 to ${MAX_MESSAGE_LENGTH} characters.` });
  if (threadId !== undefined && (typeof threadId !== "string" || !UUID.test(threadId))) return json(400, { error: "threadId must be a conversation id." });
  const selection = parseSelection(body.selection);
  if (selection === undefined) return json(400, { error: "selection must be { kind: \"file\" | \"folder\", path }." });

  const agentUrl = process.env.AGENT_URL?.trim().replace(/\/+$/, "");
  const ingressSecret = process.env.MDA_INGRESS_SECRET?.trim();
  if (!agentUrl || !ingressSecret) return json(503, { error: "Ask isn't set up: AGENT_URL and MDA_INGRESS_SECRET aren't set." });

  const supabase = await createServerSupabaseClient();
  const { data: credential, error } = await supabase.rpc("mint_ask_credential", { p_analysis_id: analysisId });
  if (error || !credential) return json(404, { error: "No such analysis." });

  // The app is the agent's trusted backend: it has authenticated the member,
  // and asserts who they are. The agent keeps each member's threads private.
  const headers = {
    "content-type": "application/json",
    "x-mda-ingress-secret": ingressSecret,
    "x-mda-user-id": identity.userId,
  };

  let thread: string;
  try {
    if (typeof threadId === "string") {
      // A conversation belongs to one analysis. Continuing it under another
      // would put one repository's answers in front of questions about another.
      const found = await fetch(`${agentUrl}/threads/${threadId}`, { headers, signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) });
      const existing = found.ok ? ((await found.json()) as { metadata?: { analysis_id?: string } }) : null;
      if (existing?.metadata?.analysis_id !== analysisId) return json(404, { error: "No such conversation." });
      thread = threadId;
    } else {
      const created = await fetch(`${agentUrl}/threads`, {
        method: "POST",
        headers,
        body: JSON.stringify({ metadata: { analysis_id: analysisId, org_id: identity.orgId } }),
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });
      if (!created.ok) return json(503, { error: UNREACHABLE });
      thread = ((await created.json()) as { thread_id: string }).thread_id;
    }
  } catch {
    return json(503, { error: UNREACHABLE });
  }

  let run: Response;
  try {
    run = await fetch(`${agentUrl}/threads/${thread}/runs/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assistant_id: ASSISTANT_ID,
        input: { messages: [{ role: "user", content: withSelection(message, selection) }] },
        context: { askCredential: credential },
        // updates: each step as it completes, tool calls included.
        // messages-tuple: the answer's tokens as they're written.
        stream_mode: ["updates", "messages-tuple"],
        on_disconnect: "cancel",
      }),
      // Closing the panel stops the run instead of leaving it spending quota.
      signal: request.signal,
    });
  } catch {
    return json(503, { error: UNREACHABLE });
  }
  if (!run.ok || !run.body) return json(503, { error: UNREACHABLE });

  return new Response(translateStream(run.body, (detail) => console.error("[ask] the agent's run failed:", detail)), {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-cache, no-transform",
      "x-thread-id": thread,
    },
  });
}
