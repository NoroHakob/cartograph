// What the Ask panel hears while the agent works, and the translation from
// the agent's LangGraph event stream into it. The panel never parses
// LangGraph: /api/ask runs the stream through translate() and sends one JSON
// event per line.
//
// Only two kinds of graph step matter: the model's (a lookup it asked for, or
// its answer) and the tools' (what a lookup returned). Everything else, such
// as middleware echoing the whole history back, is dropped, and every lookup
// and answer is sent once however many times the graph repeats it.

export type AskEvent =
  /** The agent asked for a lookup. `message` is the model turn that asked. */
  | { type: "step"; id: string; message: string; tool: string; args: Record<string, unknown> }
  /** A lookup came back. `paths` is every path-like string in it, for linking the answer. */
  | { type: "result"; id: string; ok: boolean; summary: string; paths: string[] }
  /** Part of the answer, as it's written. Appended per message. */
  | { type: "text"; message: string; text: string }
  /** The answer, whole. Replaces whatever text streamed for that message. */
  | { type: "answer"; message: string; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

const MODEL_NODES = new Set(["model_request", "model"]);
const TOOL_NODES = new Set(["tools"]);
const PATHS_PER_RESULT = 400;

type Message = {
  type?: string;
  id?: string;
  content?: unknown;
  tool_calls?: { id?: string; name?: string; args?: Record<string, unknown> }[];
  tool_call_id?: string;
  name?: string;
};

/** A message's visible text: plain content, or the text parts of a content list. Reasoning is never shown. */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && (part as { type?: unknown }).type === "text" ? String((part as { text?: unknown }).text ?? "") : ""))
    .join("");
}

/** Splits an SSE byte stream's text into complete frames, keeping any partial frame for later. */
export function sseFrames(buffer: string): { frames: { event: string; data: string }[]; rest: string } {
  const frames: { event: string; data: string }[] = [];
  const normalized = buffer.replace(/\r\n/g, "\n");
  let start = 0;
  let end: number;
  while ((end = normalized.indexOf("\n\n", start)) >= 0) {
    const block = normalized.slice(start, end);
    start = end + 2;
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length > 0) frames.push({ event, data: data.join("\n") });
  }
  return { frames, rest: normalized.slice(start) };
}

/** Turns the agent's frames into panel events. One per run: it remembers what it has sent. */
export function createTranslator() {
  const sentSteps = new Set<string>();
  const sentResults = new Set<string>();
  const sentAnswers = new Set<string>();
  const stepsByMessage = new Set<string>();
  const callArgs = new Map<string, { tool: string; args: Record<string, unknown> }>();

  function fromMessage(message: Message, node: string): AskEvent[] {
    const events: AskEvent[] = [];
    if (MODEL_NODES.has(node) && message.type === "ai") {
      const messageId = message.id ?? "";
      const calls = message.tool_calls ?? [];
      for (const call of calls) {
        if (!call.id || !call.name || sentSteps.has(call.id)) continue;
        sentSteps.add(call.id);
        stepsByMessage.add(messageId);
        const args = call.args ?? {};
        callArgs.set(call.id, { tool: call.name, args });
        events.push({ type: "step", id: call.id, message: messageId, tool: call.name, args });
      }
      const text = textOf(message.content).trim();
      // Words the model writes alongside a lookup are working notes, not the answer.
      if (calls.length === 0 && text && !sentAnswers.has(messageId)) {
        sentAnswers.add(messageId);
        events.push({ type: "answer", message: messageId, text });
      }
    }
    if (TOOL_NODES.has(node) && message.type === "tool" && message.tool_call_id && !sentResults.has(message.tool_call_id)) {
      sentResults.add(message.tool_call_id);
      const call = callArgs.get(message.tool_call_id);
      events.push(resultEvent(message.tool_call_id, call?.tool ?? message.name ?? "", call?.args ?? {}, textOf(message.content)));
    }
    return events;
  }

  return function translate(frame: { event: string; data: string }): AskEvent[] {
    let data: unknown;
    try {
      data = JSON.parse(frame.data);
    } catch {
      return [];
    }
    if (frame.event === "error") {
      const detail = data && typeof data === "object" ? String((data as { message?: unknown }).message ?? "") : "";
      return [{ type: "error", message: friendlyError(detail) }];
    }
    if (frame.event === "messages" && Array.isArray(data)) {
      const [chunk, meta] = data as [Message, { langgraph_node?: string } | undefined];
      if (!MODEL_NODES.has(meta?.langgraph_node ?? "") || !chunk?.id || sentAnswers.has(chunk.id) || stepsByMessage.has(chunk.id)) return [];
      const text = textOf(chunk.content);
      return text ? [{ type: "text", message: chunk.id, text }] : [];
    }
    if (frame.event === "updates" && data && typeof data === "object") {
      const events: AskEvent[] = [];
      for (const [node, update] of Object.entries(data as Record<string, unknown>)) {
        const messages = (update as { messages?: unknown } | null)?.messages;
        if (!Array.isArray(messages)) continue;
        for (const message of messages as Message[]) events.push(...fromMessage(message, node));
      }
      return events;
    }
    return [];
  };
}

function resultEvent(id: string, tool: string, args: Record<string, unknown>, content: string): AskEvent {
  let body: unknown;
  try {
    body = JSON.parse(content);
  } catch {
    return { type: "result", id, ok: false, summary: "The lookup returned nothing readable.", paths: [] };
  }
  const paths = [...new Set(pathLike(body))].slice(0, PATHS_PER_RESULT);
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === "string") return { type: "result", id, ok: false, summary: error.replace(/^LOOKUP_FAILED:\s*/, ""), paths };
  return { type: "result", id, ok: true, summary: summarize(tool, args, body as Record<string, unknown>), paths };
}

/** Every string in a lookup result that could be a path: no spaces, and a dot or a slash. */
function pathLike(value: unknown): string[] {
  if (typeof value === "string") return /^[^\s]+$/.test(value) && /[./]/.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(pathLike);
  if (value && typeof value === "object") return Object.values(value).flatMap(pathLike);
  return [];
}

const count = (n: unknown, one: string, many = `${one}s`) => `${Number(n ?? 0).toLocaleString("en")} ${Number(n) === 1 ? one : many}`;

/** One line for what a lookup found, from its own numbers. */
export function summarize(tool: string, args: Record<string, unknown>, body: Record<string, unknown>): string {
  switch (tool) {
    case "repo_summary":
      return `${count(body.files, "file")}, ${count(body.internalImportEdges, "link")} between them`;
    case "find_files":
      return Number(body.total) === 0 ? "No paths match" : `${count(body.total, "file")} match`;
    case "files_by_role":
      return count(body.total, "file");
    case "neighbours": {
      const imports = (body.imports as unknown[] | undefined)?.length ?? 0;
      const importedBy = (body.importedBy as unknown[] | undefined)?.length ?? 0;
      return `Imports ${imports + Number(body.importsOmitted ?? 0)}, imported by ${importedBy + Number(body.importedByOmitted ?? 0)}`;
    }
    case "walk":
      return Number(body.total) === 0 ? "Reaches no other file" : `${count(body.total, "file")} within ${count(body.depth ?? args.depth, "step")}`;
    case "routes":
      return Number(body.total) === 0 ? "No routes recorded" : count(body.total, "route");
    default:
      return "Done";
  }
}

/** What to tell a person when the agent's run fails. The detail stays in the server log. */
export function friendlyError(detail: string): string {
  if (/quota|rate.?limit|429|resource.?exhausted/i.test(detail)) return "The model's quota is used up for now. Try again later.";
  if (/overloaded|503|unavailable/i.test(detail)) return "The model is overloaded right now. Try again in a moment.";
  return "The agent ran into a problem and stopped. Try asking again.";
}

/**
 * The agent's SSE body as panel events, one JSON object per line, ending with
 * done. `onError` hears the first failure's raw detail, for the server log;
 * the person sees only the plain sentence.
 */
export function translateStream(body: ReadableStream<Uint8Array>, onError?: (detail: string) => void): ReadableStream<Uint8Array> {
  const translate = createTranslator();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const line = (event: AskEvent) => encoder.encode(`${JSON.stringify(event)}\n`);
  let buffer = "";
  let failed = false;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const { frames, rest } = sseFrames(buffer + decoder.decode(chunk, { stream: true }));
        buffer = rest;
        for (const frame of frames) {
          for (const event of translate(frame)) {
            if (event.type === "error") {
              if (failed) continue;
              failed = true;
              onError?.(frame.data.slice(0, 500));
            }
            controller.enqueue(line(event));
          }
        }
      },
      flush(controller) {
        controller.enqueue(line({ type: "done" }));
      },
    }),
  );
}
