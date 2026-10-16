import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { readParseResult } from "../parser/output";
import { conventions, folderSummary, neighbourIndex, repoSummary, type DetailFile } from "./detail";
import { fold } from "./fold";
import type { MapEdge } from "./view";

const file = (p: string, fanIn = 0, fanOut = 0): DetailFile => {
  const slash = p.lastIndexOf("/");
  return { path: p, folder: slash < 0 ? "." : p.slice(0, slash), language: "ts", lineCount: 10, fanIn, fanOut };
};
const edge = (source: string, target: string, typeOnly = false): MapEdge => ({ source, target, typeOnly });
const none = conventions({ routes: [], entryPoints: [] });

describe("conventions", () => {
  test("routes and entry points come from the parser; tests and configs from their names", () => {
    const known = conventions({
      routes: [{ file: "app/page.tsx", path: "/", kind: "page", methods: [] }],
      entryPoints: [{ path: "src/index.ts", origin: "package.json#main" }],
    });
    assert.deepEqual(known.of("app/page.tsx").map((c) => c.id), ["route"]);
    assert.deepEqual(known.of("src/index.ts").map((c) => [c.id, c.detail]), [["entry", "package.json#main"]]);
    assert.deepEqual(known.of("src/a.test.ts").map((c) => c.id), ["test"]);
    assert.deepEqual(known.of("src/__tests__/a.ts").map((c) => c.id), ["test"]);
    assert.deepEqual(known.of("vite.config.ts").map((c) => c.id), ["config"]);
    assert.deepEqual(known.of("src/contest.ts"), []);
    assert.deepEqual(known.of("src/latest/a.ts"), []);
  });
});

describe("neighbours", () => {
  test("one entry per file each way, sorted", () => {
    const of = neighbourIndex([edge("a", "c"), edge("a", "b", true), edge("d", "a")]);
    assert.deepEqual(of("a"), {
      imports: [
        { path: "b", typeOnly: true },
        { path: "c", typeOnly: false },
      ],
      importedBy: [{ path: "d", typeOnly: false }],
    });
    assert.deepEqual(of("z"), { imports: [], importedBy: [] });
  });
});

describe("repository summary", () => {
  test("ranks the depended-on by fan-in and puts tests last among the unimported", () => {
    const files = [file("lib.ts", 3), file("util.ts", 1, 1), file("a.test.ts", 0, 5), file("cli.ts", 0, 2), file("main.ts", 0, 1)];
    const known = conventions({ routes: [], entryPoints: [{ path: "main.ts", origin: "package.json#bin" }] });
    const summary = repoSummary(files, [], known);
    assert.deepEqual(summary.mostDependedOn.map((f) => f.path), ["lib.ts", "util.ts"]);
    assert.deepEqual(summary.startHere.map((f) => f.path), ["main.ts", "cli.ts", "a.test.ts"]);
    assert.equal(summary.unidentified, 3);
  });
});

describe("folder summary", () => {
  test("counts kinds of file and roles inside the folder", () => {
    const files = [file("src/a.ts", 1), file("src/a.test.ts"), file("src/b.ts", 2)];
    const byPath = new Map(files.map((f) => [f.path, f]));
    const summary = folderSummary(fold(files), "src", byPath, none)!;
    assert.deepEqual(summary.files.map((f) => f.path), ["src/b.ts", "src/a.ts", "src/a.test.ts"]);
    assert.deepEqual(summary.languages, [{ language: "ts", count: 3 }]);
    assert.deepEqual(summary.conventions, [{ id: "test", count: 1 }]);
    assert.equal(summary.unidentified, 2);
  });
});

describe("the hono fixture", () => {
  const result = readParseResult(path.join(process.cwd(), "src/app/preview/fixture/hono.parse.json"));
  const of = neighbourIndex(result.edges);

  test("every file's listed neighbours match its fan-in and fan-out", () => {
    for (const f of result.files) {
      const { imports, importedBy } = of(f.path);
      assert.equal(imports.length, f.fanOut, f.path);
      assert.equal(importedBy.length, f.fanIn, f.path);
    }
  });

  test("the summary covers every file", () => {
    const files = result.files;
    const summary = repoSummary(files, result.edges, none);
    assert.equal(summary.mostDependedOn.length + summary.startHere.length, files.length);
    assert.ok(summary.unidentified > 0 && summary.unidentified < files.length);
  });
});
