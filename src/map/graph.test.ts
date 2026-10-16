import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { readParseResult } from "../parser/output";
import { conventions, type DetailFile } from "./detail";
import { graphIndex, HUB_MIN_FAN_IN, importCycles, insights, OVERSIZED_LINES, reach, reachedByFramework } from "./graph";
import type { MapEdge } from "./view";

const file = (p: string, fanIn = 0, fanOut = 0, lineCount = 10): DetailFile => {
  const slash = p.lastIndexOf("/");
  return { path: p, folder: slash < 0 ? "." : p.slice(0, slash), language: "ts", lineCount, fanIn, fanOut };
};
const edge = (source: string, target: string): MapEdge => ({ source, target, typeOnly: false });
const none = conventions({ routes: [], entryPoints: [] });

describe("reach", () => {
  // a → b → c → d, and e → b
  const index = graphIndex([edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("e", "b")]);

  test("blast radius walks importers, two levels deep", () => {
    assert.deepEqual(reach(index, "c", "dependents"), [
      { path: "b", depth: 1 },
      { path: "a", depth: 2 },
      { path: "e", depth: 2 },
    ]);
  });

  test("dependency chain walks imports, and the depth limit holds", () => {
    assert.deepEqual(reach(index, "a", "dependencies"), [
      { path: "b", depth: 1 },
      { path: "c", depth: 2 },
    ]);
    assert.deepEqual(reach(index, "a", "dependencies", 3).at(-1), { path: "d", depth: 3 });
  });

  test("a cycle never lists the start or a file twice", () => {
    const cyclic = graphIndex([edge("a", "b"), edge("b", "a"), edge("b", "c"), edge("c", "a")]);
    assert.deepEqual(reach(cyclic, "a", "dependencies", 5), [
      { path: "b", depth: 1 },
      { path: "c", depth: 2 },
    ]);
  });
});

describe("import cycles", () => {
  test("finds each loop once, including a file importing itself", () => {
    const index = graphIndex([edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("c", "d"), edge("d", "e"), edge("e", "d"), edge("f", "f"), edge("g", "a")]);
    assert.deepEqual(importCycles(["a", "b", "c", "d", "e", "f", "g"], index), [["a", "b", "c"], ["d", "e"], ["f"]]);
  });

  test("a chain deep enough to overflow a recursive walk", () => {
    const n = 200_000;
    const names = Array.from({ length: n }, (_, i) => `f${i}`);
    const edges = names.map((name, i) => edge(name, names[(i + 1) % n]));
    assert.equal(importCycles(names, graphIndex(edges))[0].length, n);
  });
});

describe("insights", () => {
  test("files nothing imports leave out what a framework, package or test runner reaches", () => {
    const files = [
      file("src/orphan.ts", 0, 2),
      file("src/lonely.ts"),
      file("src/main.ts"),
      file("src/a.test.ts"),
      file("vite.config.ts"),
      file("app/blog/[slug]/page.tsx"),
      file("src/middleware.ts"),
      file("src/used.ts", 1),
    ];
    const known = conventions({ routes: [], entryPoints: [{ path: "src/main.ts", origin: "package.json#main" }] });
    assert.deepEqual(insights(files, graphIndex([]), known).unimported.map((f) => f.path), ["src/orphan.ts", "src/lonely.ts"]);
  });

  test("framework names", () => {
    assert.ok(reachedByFramework("app/layout.tsx"));
    assert.ok(reachedByFramework("src/app/api/users/route.ts"));
    assert.ok(reachedByFramework("pages/index.jsx"));
    assert.ok(reachedByFramework("proxy.ts"));
    assert.ok(!reachedByFramework("src/components/page.tsx"));
    assert.ok(!reachedByFramework("src/lib/middleware.ts"));
  });

  test("hubs and oversized files", () => {
    const files = [file("hub.ts", HUB_MIN_FAN_IN), file("busy.ts", HUB_MIN_FAN_IN - 1), file("long.ts", 1, 0, OVERSIZED_LINES + 1), file("edge.ts", 1, 0, OVERSIZED_LINES)];
    const found = insights(files, graphIndex([]), none);
    assert.deepEqual(found.hubs.map((f) => f.path), ["hub.ts"]);
    assert.deepEqual(found.oversized.map((f) => f.path), ["long.ts"]);
  });
});

describe("the hono fixture", () => {
  const result = readParseResult(path.join(process.cwd(), "src/app/preview/fixture/hono.parse.json"));
  const index = graphIndex(result.edges);

  test("one level of reach is exactly a file's neighbours", () => {
    for (const f of result.files) {
      assert.equal(reach(index, f.path, "dependents", 1).length, f.fanIn, f.path);
      assert.equal(reach(index, f.path, "dependencies", 1).length, f.fanOut, f.path);
    }
  });

  test("every cycle is a real loop over parser edges", () => {
    for (const cycle of importCycles(result.files.map((f) => f.path), index)) {
      const members = new Set(cycle);
      for (const member of cycle) {
        // Inside a strongly connected component, every member reaches every other.
        const reached = new Set(reach(index, member, "dependencies", cycle.length).map((r) => r.path));
        for (const other of members) if (other !== member) assert.ok(reached.has(other), `${member} → ${other}`);
      }
    }
  });
});
