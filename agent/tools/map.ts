import { tool } from "langchain";
import { z } from "zod";

// The six lookups. Each is a POST to the app's read-only tool surface, which
// runs the same graph functions that draw the canvas. None of them computes
// anything here, and none takes an analysis id: which analysis is read is
// decided by the Ask credential, never by the model.
//
// The credential arrives as run context from the app, and goes out only as
// the bearer token. It's never in a prompt, a message or a tool argument.

/** The tool surface: the app's `/api/ask/tools`, or `pnpm ask:tools` over the fixture. */
const BASE_URL = (process.env.CARTOGRAPH_TOOLS_URL ?? "http://localhost:3000/api/ask/tools").replace(/\/+$/, "");
const TIMEOUT_MS = 15_000;

/** What each run is given besides the conversation. */
export const askContext = z.object({
  askCredential: z.string().optional().describe("Short-lived credential naming one analysis. Minted by the app per question."),
});
type AskRuntime = { context?: z.infer<typeof askContext> };

/**
 * Calls one tool and returns its JSON as text for the model. A rejected
 * argument (400) comes back as the surface's error, with real paths or roles
 * to retry with. An unreachable surface is reported as a failed lookup, so
 * the model says it couldn't look rather than answering anyway.
 */
async function lookup(runtime: AskRuntime, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const credential = runtime.context?.askCredential;
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(credential && { authorization: `Bearer ${credential}` }) },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return JSON.stringify({ error: "LOOKUP_FAILED: the map could not be reached. Nothing was looked up." });
  }
  const body = await response.text();
  if (response.ok || response.status === 400) return body;
  if (response.status === 401) return JSON.stringify({ error: "LOOKUP_FAILED: this question's access to the map has expired. Nothing was looked up." });
  return JSON.stringify({ error: `LOOKUP_FAILED: the map answered ${response.status}. Nothing was looked up.` });
}

const path = z.string().describe('A repository-relative file path exactly as a previous lookup returned it, e.g. "src/auth/session.ts".');

export const repoSummary = tool(async (_input, runtime: AskRuntime) => lookup(runtime, "repo_summary"), {
  name: "repo_summary",
  description:
    "Overview of the whole analysed repository: framework, file and import counts, how many files have each role, entry points, the most depended-on files, where to start reading, import cycles, hubs, unimported and oversized files. Use first for broad questions about the repository.",
  schema: z.object({}),
});

export const findFiles = tool(async ({ query }, runtime: AskRuntime) => lookup(runtime, "find_files", { query }), {
  name: "find_files",
  description:
    'Files whose path contains `query` (case-insensitive), most depended-on first. Use to find where something lives by name, e.g. "auth", "session", "middleware/", "db". Try several short fragments before concluding nothing matches.',
  schema: z.object({ query: z.string().describe("Part of a file or folder path.") }),
});

export const filesByRole = tool(async ({ role }, runtime: AskRuntime) => lookup(runtime, "files_by_role", { role }), {
  name: "files_by_role",
  description:
    'Every file the parser gave a role, e.g. "service", "controller", "route", "page", "api", "middleware", "component", "hook", "test", "config", "source". An absent role returns the roles this repository does have.',
  schema: z.object({ role: z.string().describe("A role id.") }),
});

export const neighbours = tool(async ({ path }, runtime: AskRuntime) => lookup(runtime, "neighbours", { path }), {
  name: "neighbours",
  description: "What one file imports and what imports it, directly (one step each way), plus its conventions such as route, entry point, test or config.",
  schema: z.object({ path }),
});

export const walk = tool(async ({ path, direction, depth }, runtime: AskRuntime) => lookup(runtime, "walk", { path, direction, ...(depth !== undefined && { depth }) }), {
  name: "walk",
  description:
    'Every file within `depth` import steps of a file. direction "dependents" is the blast radius: the files that would be affected if this file changed. direction "dependencies" is everything this file relies on. Depth defaults to 2.',
  schema: z.object({
    path,
    direction: z.enum(["dependents", "dependencies"]),
    depth: z.number().int().min(1).max(4).optional().describe("Import steps to follow, 1 to 4. Default 2."),
  }),
});

export const routes = tool(async (_input, runtime: AskRuntime) => lookup(runtime, "routes"), {
  name: "routes",
  description: "The route table the framework adapter recorded: each route's URL pattern, methods, kind, and the file and line that declare it.",
  schema: z.object({}),
});

export const MAP_TOOLS = [repoSummary, findFiles, filesByRole, neighbours, walk, routes];
