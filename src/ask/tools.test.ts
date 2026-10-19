import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DetailFile } from "../map/detail";
import { graphIndex, reach } from "../map/graph";
import type { MapEdge } from "../map/view";
import type { RoleId } from "../parser/taxonomy";
import { askTools, runTool, ToolInputError, type AskGraph } from "./tools";

const file = (p: string, role: RoleId = "source", fanIn = 0, fanOut = 0): DetailFile => {
  const slash = p.lastIndexOf("/");
  return { path: p, folder: slash < 0 ? "." : p.slice(0, slash), language: "ts", role, lineCount: 10, fanIn, fanOut };
};
const edge = (source: string, target: string): MapEdge => ({ source, target, typeOnly: false });

// index → auth/session → auth/token → lib/crypto; routes/login → auth/session
const edges = [
  edge("src/index.ts", "src/auth/session.ts"),
  edge("src/auth/session.ts", "src/auth/token.ts"),
  edge("src/auth/token.ts", "src/lib/crypto.ts"),
  edge("src/routes/login.ts", "src/auth/session.ts"),
];
const graph: AskGraph = {
  framework: "express",
  files: [
    file("src/index.ts", "entry", 0, 1),
    file("src/auth/session.ts", "service", 2, 1),
    file("src/auth/token.ts", "service", 1, 1),
    file("src/lib/crypto.ts", "other", 1, 0),
    file("src/routes/login.ts", "route", 0, 1),
  ],
  edges,
  facts: {
    name: "demo",
    framework: "Express",
    importCount: 4,
    routes: [{ file: "src/routes/login.ts", path: "/login", kind: "api", methods: ["POST"], line: 3 }],
    entryPoints: [{ path: "src/index.ts", origin: "package.json#main" }],
  },
};
const tools = askTools(graph);

describe("ask tools", () => {
  test("the walk is the canvas's walk, unchanged", () => {
    const walked = tools.walk({ path: "src/auth/token.ts", direction: "dependents", depth: 2 });
    assert.deepEqual(walked.files, reach(graphIndex(edges), "src/auth/token.ts", "dependents", 2));
    assert.deepEqual(walked.countByDepth, [1, 2]);
  });

  test("find_files matches part of a path, most depended-on first", () => {
    const found = tools.find_files({ query: "AUTH" });
    assert.deepEqual(
      found.files.map((f) => f.path),
      ["src/auth/session.ts", "src/auth/token.ts"],
    );
  });

  test("neighbours lists both directions and the file's conventions", () => {
    const n = tools.neighbours({ path: "src/auth/session.ts" });
    assert.deepEqual(
      n.importedBy.map((i) => i.path),
      ["src/index.ts", "src/routes/login.ts"],
    );
    assert.deepEqual(
      n.imports.map((i) => i.path),
      ["src/auth/token.ts"],
    );
    assert.equal(tools.neighbours({ path: "src/routes/login.ts" }).conventions[0].detail, "POST /login");
  });

  test("an unknown path is an error with real paths, never a guess", () => {
    assert.throws(
      () => tools.neighbours({ path: "auth/session.ts" }),
      (e: unknown) => e instanceof ToolInputError && (e.details.similarPaths as string[])[0] === "src/auth/session.ts",
    );
  });

  test("an absent role lists the roles that are present", () => {
    assert.equal(tools.files_by_role({ role: "service" }).total, 2);
    assert.throws(
      () => tools.files_by_role({ role: "controller" }),
      (e: unknown) => e instanceof ToolInputError && Array.isArray(e.details.rolesPresent),
    );
  });

  test("summary and routes report the parser's facts", () => {
    const s = tools.repo_summary();
    assert.equal(s.files, 5);
    assert.equal(s.internalImportEdges, 4);
    assert.equal(s.mostDependedOn[0].path, "src/auth/session.ts");
    assert.deepEqual(tools.routes().routes, [{ path: "/login", methods: ["POST"], kind: "api", file: "src/routes/login.ts", line: 3 }]);
  });

  test("runTool checks arguments before any lookup", () => {
    assert.throws(() => runTool(tools, "rm_rf", {}), ToolInputError);
    assert.throws(() => runTool(tools, "walk", { path: "src/index.ts", direction: "sideways" }), ToolInputError);
    assert.throws(() => runTool(tools, "walk", { path: "src/index.ts", direction: "dependencies", depth: 9 }), ToolInputError);
    assert.throws(() => runTool(tools, "find_files", {}), ToolInputError);
    assert.equal((runTool(tools, "walk", { path: "src/index.ts", direction: "dependencies" }) as { total: number }).total, 2);
  });
});
