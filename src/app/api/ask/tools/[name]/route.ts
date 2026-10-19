import { loadExplorer } from "@/app/o/[slug]/analyses/[id]/explorer-data";
import { askTools, runTool, ToolInputError, type AskTools } from "@/ask/tools";
import { createAskSupabaseClient } from "@/lib/supabase/ask";

// The agent's read-only tool surface. It has no signed-in user: the request
// carries an Ask credential as a bearer token, and every read goes through
// Supabase as anon with that credential, where RLS lets it see exactly the
// one analysis the credential names. This route never takes an analysis id
// from the request and never verifies the credential itself; it asks the
// database which analysis it may see, and there is at most one.
//
//   POST /api/ask/tools/<name>   Authorization: Bearer <credential>
//                                body: the tool's JSON arguments
//   → 200 result | 400 { error, ... } | 401 { error } | 404 { error }

/** Built graphs, briefly, so a run's three lookups don't load the analysis three times. */
const cache = new Map<string, { tools: AskTools; at: number }>();
const CACHE_MS = 60_000;
const CACHE_ENTRIES = 20;

const json = (status: number, body: unknown) => Response.json(body, { status });

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const credential = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!credential) return json(401, { error: "An Ask credential is required." });

  // The credential is checked on every call, cached graph or not.
  const supabase = createAskSupabaseClient(credential);
  const { data: analysis, error } = await supabase.from("analyses").select("id").maybeSingle();
  if (error) return json(502, { error: "The analysis couldn't be read." });
  if (!analysis) return json(401, { error: "The Ask credential is invalid or has expired." });

  let tools = fresh(analysis.id);
  if (!tools) {
    const explorer = await loadExplorer(analysis.id, supabase);
    if (!explorer) return json(404, { error: "The analysis isn't complete." });
    tools = askTools(explorer);
    remember(analysis.id, tools);
  }

  let input: unknown;
  try {
    const raw = await request.text();
    input = raw ? JSON.parse(raw) : {};
  } catch {
    return json(400, { error: "The body must be JSON." });
  }
  try {
    return json(200, runTool(tools, name, input));
  } catch (e) {
    if (e instanceof ToolInputError) return json(400, { error: e.message, ...e.details });
    throw e;
  }
}

function fresh(analysisId: string): AskTools | undefined {
  const entry = cache.get(analysisId);
  if (entry && Date.now() - entry.at < CACHE_MS) return entry.tools;
  cache.delete(analysisId);
  return undefined;
}

function remember(analysisId: string, tools: AskTools) {
  cache.set(analysisId, { tools, at: Date.now() });
  // Oldest first: Map keeps insertion order.
  while (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
}
