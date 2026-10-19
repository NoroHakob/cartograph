// Usage: pnpm ask:tools [result.json] [--port 3999]
//
// Development only: serves the agent's six tools over one parse result on
// localhost, so the agent can be run and watched before the real surface
// exists. Defaults to the preview's checked-in hono fixture. No sign-in, no
// database, no credential: it binds to 127.0.0.1 and holds nothing but the
// file it was given. The app's credentialed surface replaces it; the request
// and response shapes stay the same.
//
//   POST /tools/<name>   body: the tool's JSON arguments   → 200 JSON result
//                                                          → 400 { error, ... }

import { createServer } from "node:http";
import path from "node:path";
import { readParseResult } from "../parser/output";
import { askTools, runTool, TOOL_NAMES, ToolInputError, type AskGraph } from "./tools";

const FIXTURE = "src/app/preview/fixture/hono.parse.json";

function main(argv: string[]) {
  let file = FIXTURE;
  let port = 3999;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") port = Number(argv[++i]);
    else file = argv[i];
  }

  // readParseResult checks the version and every invariant before returning.
  const result = readParseResult(path.resolve(file));
  const graph: AskGraph = {
    framework: result.adapter.id,
    files: result.files.map(({ path, folder, language, role, lineCount, fanIn, fanOut }) => ({ path, folder, language, role, lineCount, fanIn, fanOut })),
    edges: result.edges.map(({ source, target, typeOnly }) => ({ source, target, typeOnly })),
    facts: {
      name: path.basename(result.root),
      framework: result.adapter.name,
      importCount: result.imports.length,
      routes: result.routes,
      entryPoints: result.entryPoints.flatMap(({ path, origin }) => (path === null ? [] : [{ path, origin }])),
    },
  };
  const tools = askTools(graph);

  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const match = /^\/tools\/([a-z_]+)$/.exec(req.url ?? "");
    if (req.method !== "POST" || !match) return send(404, { error: "POST /tools/<name>", tools: TOOL_NAMES });

    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const started = Date.now();
      try {
        const input: unknown = raw ? JSON.parse(raw) : {};
        const output = runTool(tools, match[1], input);
        console.log(`${match[1]} ${raw || "{}"} → 200 in ${Date.now() - started} ms`);
        send(200, output);
      } catch (error) {
        if (error instanceof ToolInputError) {
          console.log(`${match[1]} ${raw || "{}"} → 400 ${error.message}`);
          return send(400, { error: error.message, ...error.details });
        }
        if (error instanceof SyntaxError) return send(400, { error: "The body must be JSON." });
        console.error(error);
        send(500, { error: "The lookup failed." });
      }
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`ask tools  ${graph.facts.name}: ${graph.files.length} files, ${graph.edges.length} edges, ${graph.facts.routes.length} routes`);
    console.log(`listening  http://127.0.0.1:${port}/tools/<${TOOL_NAMES.join("|")}>`);
  });
}

main(process.argv.slice(2));
