import { createMiddleware } from "langchain";

// A Deep Agent always brings its own tools: a todo planner, a filesystem and
// sub-agents. None of those is in scope, and the filesystem is a place to
// "look" that isn't the map. This offers the model only the lookups it was
// given, so every answer comes from the parser's output or from nothing.

export function onlyMapTools(names: readonly string[]) {
  const allowed = new Set(names);
  return createMiddleware({
    name: "OnlyMapTools",
    wrapModelCall: (request, handler) =>
      handler({ ...request, tools: request.tools.filter((t) => "name" in t && typeof t.name === "string" && allowed.has(t.name)) }),
  });
}
