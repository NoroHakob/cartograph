import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

// Development only, selected with CARTOGRAPH_MODEL=scripted. A stand-in for
// Gemini that makes real lookups on a fixed script, so the whole path (app,
// credential, agent, tool surface, RLS, stream, panel) can be exercised
// without a model key or quota. It never pretends to understand the question.
//
// Per question: repo_summary, then find_files with the question's longest
// word (or, with a file selected, a walk of what depends on it), then an
// answer that only reports what the lookups returned, naming paths they
// returned so the panel's links can be checked.

const SELECTED_FILE = /\(Selected on the map: file `([^`]+)`\)/;

export class ScriptedModel extends BaseChatModel {
  _llmType() {
    return "cartograph-scripted";
  }

  // Tools are offered to the model on every call; the script doesn't need them.
  bindTools() {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const turn = messages.slice(messages.findLastIndex((m) => m.getType() === "human"));
    const question = String(turn[0]?.content ?? "");
    const results = turn.filter((m): m is ToolMessage => ToolMessage.isInstance(m));
    const id = `scripted-${Date.now()}`;
    const selected = SELECTED_FILE.exec(question)?.[1];

    let message: AIMessage;
    if (results.length === 0) {
      message = new AIMessage({ content: "", tool_calls: [{ id, name: "repo_summary", args: {} }] });
    } else if (results.length === 1) {
      const words = question.replace(SELECTED_FILE, "").split(/[^A-Za-z0-9_-]+/);
      const query = words.sort((a, b) => b.length - a.length)[0] || "src";
      message = new AIMessage({
        content: "",
        tool_calls: [selected ? { id, name: "walk", args: { path: selected, direction: "dependents" } } : { id, name: "find_files", args: { query } }],
      });
    } else {
      message = new AIMessage(answerFrom(results));
    }
    return { generations: [{ text: typeof message.content === "string" ? message.content : "", message }] };
  }
}

/** A plain report of the last lookup: the paths it returned, as the real model would cite them. */
function answerFrom(results: ToolMessage[]): string {
  const last = results.at(-1)!;
  let body: { error?: string; files?: { path: string }[]; total?: number } = {};
  try {
    body = JSON.parse(String(last.content));
  } catch {
    // Reported below as nothing found.
  }
  if (body.error) return `Scripted answer (no model). The last lookup failed: ${body.error.replace(/^LOOKUP_FAILED:\s*/, "")}`;
  const paths = (body.files ?? []).slice(0, 5).map((f) => `- \`${f.path}\``);
  if (paths.length === 0) return "Scripted answer (no model). Nothing in the map matched.";
  return `Scripted answer (no model). The map shows ${body.total ?? paths.length} files, the first ones being:\n\n${paths.join("\n")}`;
}
