import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { readParseResult } from "../parser/output";
import { categoriesOf } from "./categories";
import { fold, foldAt, MAX_READABLE_NODES } from "./fold";
import { layoutView } from "./layout";
import { onScreen, refitToInclude, unionOf } from "./refit";
import { highlightFor } from "./selection";
import { ABOVE_IN, BELOW_IN, computeView, groupStats, nodeId, PANEL_ROW_LIMIT, rowIn, rowOut, shortestUniqueLabels, type MapFile } from "./view";

const file = (p: string, fanIn = 0): MapFile => {
  const slash = p.lastIndexOf("/");
  return { path: p, folder: slash < 0 ? "." : p.slice(0, slash), language: "ts", fanIn, fanOut: 0 };
};

const dirsOf = (files: MapFile[], threshold: number) => foldAt(files, threshold).groups.map((g) => `${g.dir}:${g.files.length}`);

describe("folding", () => {
  test("a directory with fewer files than the threshold merges into its parent", () => {
    const files = [file("a.ts"), file("src/x.ts"), file("src/y.ts"), file("src/lone/z.ts")];
    assert.deepEqual(dirsOf(files, 2), [".:1", "src:3"]);
  });

  test("merges cascade upward, deepest first", () => {
    // deep/er holds one file: it merges into deep, which then holds two and stays.
    const files = [file("deep/a.ts"), file("deep/er/b.ts")];
    assert.deepEqual(dirsOf(files, 2), ["deep:2"]);
    // At 3, deep (2 files after its child merged) merges into the root.
    assert.deepEqual(dirsOf(files, 3), [".:2"]);
  });

  test("merges at one depth don't change what siblings at that depth see", () => {
    // p/a and p/b each hold one file. Both merge into p together; neither
    // sees the other's file, so neither survives on the strength of it.
    const files = [file("p/a/1.ts"), file("p/b/2.ts"), file("p/b/c/3.ts"), file("p/b/c/4.ts")];
    assert.deepEqual(dirsOf(files, 2), ["p:2", "p/b/c:2"]);
  });

  test("directories holding no files directly don't become nodes", () => {
    const files = [file("a/b/c/1.ts"), file("a/b/c/2.ts")];
    assert.deepEqual(dirsOf(files, 2), ["a/b/c:2"]);
  });

  test("the threshold rises until the map is readable, and stops at the lowest that is", () => {
    const files = Array.from({ length: 30 }, (_, i) => [file(`d${i}/a.ts`), file(`d${i}/b.ts`)]).flat();
    assert.equal(foldAt(files, 2).groups.length, 30);
    const result = fold(files);
    assert.equal(result.threshold, 3);
    assert.equal(result.groups.length, 1);
    assert.equal(fold(files, 30).threshold, 2);
  });

  test("every file lands in exactly one group", () => {
    const files = [file("a.ts"), file("x/b.ts"), file("x/y/c.ts"), file("x/y/d.ts"), file("z/e.ts")];
    const result = fold(files, 2);
    assert.equal(result.groupOf.size, files.length);
    assert.equal(result.groups.reduce((n, g) => n + g.files.length, 0), files.length);
  });
});

describe("labels", () => {
  test("the shortest trailing segments that are unique", () => {
    const labels = shortestUniqueLabels(["src/utils", "src/middleware/jwt", "src/utils/jwt", "src/adapter/bun", "adapters/bun/src"]);
    assert.deepEqual(Object.fromEntries(labels), {
      "src/utils": "utils",
      "src/middleware/jwt": "middleware/jwt",
      "src/utils/jwt": "utils/jwt",
      "src/adapter/bun": "bun",
      "adapters/bun/src": "src",
    });
  });

  test("a path that is a suffix of another keeps its whole length and the other grows", () => {
    const labels = shortestUniqueLabels(["src", "a/src"]);
    assert.equal(labels.get("src"), "src");
    assert.equal(labels.get("a/src"), "a/src");
  });
});

describe("view", () => {
  const files = [
    file("app/main.ts"),
    file("app/other.ts"),
    ...Array.from({ length: PANEL_ROW_LIMIT + 3 }, (_, i) => file(`lib/f${String(i).padStart(2, "0")}.ts`, i === 0 ? 2 : 0)),
  ];
  const edges = [
    { source: "app/main.ts", target: "lib/f00.ts", typeOnly: false },
    { source: "app/other.ts", target: "lib/f00.ts", typeOnly: true },
    { source: "app/main.ts", target: `lib/f${PANEL_ROW_LIMIT + 2}.ts`, typeOnly: false },
    { source: "lib/f01.ts", target: "lib/f00.ts", typeOnly: false },
  ];
  const folded = fold(files);
  const stats = groupStats(folded, files, edges);

  test("folded nodes connect node to node, merged and without internal edges", () => {
    const view = computeView(folded, stats, files, edges, new Set(), "repo");
    assert.deepEqual(view.edges.map((e) => [e.source, e.target, e.count, e.typeOnly]), [[nodeId("app"), nodeId("lib"), 3, false]]);
    assert.equal(stats.get("lib")!.fanIn, 2);
  });

  test("an open panel holds every file; rows below the window land on the footer", () => {
    const view = computeView(folded, stats, files, edges, new Set(["lib"]), "repo");
    const lib = view.nodes.find((n) => n.dir === "lib")!;
    assert.equal(lib.rows.length, PANEL_ROW_LIMIT + 3);
    assert.deepEqual([lib.windowStart, lib.hiddenAbove, lib.hiddenBelow], [0, 0, 3]);
    assert.equal(lib.rows[0].path, "lib/f00.ts", "most depended-on first");
    const handles = view.edges.map((e) => e.targetHandle).sort();
    assert.deepEqual(handles, [BELOW_IN, rowIn("lib/f00.ts")].sort());
    assert.equal(view.edges.find((e) => e.targetHandle === rowIn("lib/f00.ts"))!.count, 2);
  });

  test("scrolling moves the window: rows above it land on the header, rows in it get their own", () => {
    const last = `lib/f${PANEL_ROW_LIMIT + 2}.ts`;
    const view = computeView(folded, stats, files, edges, new Set(["lib"]), "repo", new Map([["lib", 3]]));
    const lib = view.nodes.find((n) => n.dir === "lib")!;
    assert.deepEqual([lib.windowStart, lib.hiddenAbove, lib.hiddenBelow], [3, 3, 0]);
    assert.deepEqual(view.edges.map((e) => e.targetHandle).sort(), [ABOVE_IN, rowIn(last)].sort());
    // Scrolling past the end clamps to the last full window.
    const clamped = computeView(folded, stats, files, edges, new Set(["lib"]), "repo", new Map([["lib", 99]]));
    assert.equal(clamped.nodes.find((n) => n.dir === "lib")!.windowStart, 3);
  });

  test("a selected row scrolled out of view keeps its edges, through the count standing in for it", () => {
    const view = computeView(folded, stats, files, edges, new Set(["app", "lib"]), "repo", new Map([["lib", 3]]));
    const lit = highlightFor(view, { kind: "row", node: nodeId("lib"), path: "lib/f00.ts" })!;
    assert.deepEqual([...lit.edges.values()], ["in", "in"]);
    assert.ok(lit.above.has(nodeId("lib")));
    assert.deepEqual([...lit.rows].sort(), ["app/main.ts", "app/other.ts", "lib/f00.ts"]);
  });

  test("scrolling never changes the layout", () => {
    const at = (start: number) => layoutView(computeView(folded, stats, files, edges, new Set(["lib"]), "repo", new Map([["lib", start]])));
    assert.deepEqual([...at(0).boxes], [...at(3).boxes]);
  });

  test("selecting a row keeps it, its edges and their other ends lit", () => {
    const view = computeView(folded, stats, files, edges, new Set(["app", "lib"]), "repo");
    const lit = highlightFor(view, { kind: "row", node: nodeId("lib"), path: "lib/f00.ts" })!;
    assert.deepEqual([...lit.rows].sort(), ["app/main.ts", "app/other.ts", "lib/f00.ts"]);
    assert.deepEqual([...lit.edges.values()], ["in", "in"], "f00 is imported, so both edges come in");
    assert.ok(!lit.rows.has("lib/f01.ts"));
    const main = highlightFor(view, { kind: "row", node: nodeId("app"), path: "app/main.ts" })!;
    assert.deepEqual([...main.edges.values()], ["out", "out"], "main imports, so both edges go out");
    const fromMain = view.edges.filter((e) => e.sourceHandle === rowOut("app/main.ts"));
    assert.equal(fromMain.length, 2, "main reaches f00 and the footer");
  });
});

describe("refit", () => {
  const screen = { width: 1000, height: 800 };

  test("does nothing when the panel is already on screen", () => {
    assert.equal(refitToInclude({ x: 0, y: 0, zoom: 1 }, screen, { x: 100, y: 100, width: 200, height: 200 }, 0.1), null);
  });

  test("zooms out to take in a panel off screen, never in", () => {
    for (const zoom of [0.3, 1, 2]) {
      const next = refitToInclude({ x: 0, y: 0, zoom }, screen, { x: 5000, y: 100, width: 300, height: 400 }, 0.05)!;
      assert.ok(next.zoom <= zoom, `zoom ${zoom} became ${next.zoom}`);
      const left = (5000 * next.zoom + next.x) >= 0;
      const right = ((5300) * next.zoom + next.x) <= screen.width;
      assert.ok(left && right, "panel is inside the screen");
    }
  });

  test("finds what is on screen, so it can be kept there after a relayout", () => {
    const boxes = new Map([
      ["in", { x: 10, y: 10, width: 50, height: 50 }],
      ["edge", { x: 990, y: 790, width: 50, height: 50 }],
      ["off", { x: 2000, y: 10, width: 50, height: 50 }],
    ]);
    assert.deepEqual(onScreen({ x: 0, y: 0, zoom: 1 }, screen, boxes), ["in", "edge"]);
    assert.deepEqual(unionOf([...boxes.values()]), { x: 10, y: 10, width: 2040, height: 830 });
  });

  test("a panel bigger than the screen still can't zoom the view in", () => {
    const next = refitToInclude({ x: 0, y: 0, zoom: 0.5 }, screen, { x: -50, y: -50, width: 100, height: 100 }, 0.1)!;
    assert.ok(next.zoom <= 0.5);
  });
});

describe("the hono fixture", () => {
  const result = readParseResult(path.join(__dirname, "../app/preview/fixture/hono.parse.json"));
  const folded = fold(result.files);
  const stats = groupStats(folded, result.files, result.edges);

  test("is big enough to test folding", () => {
    assert.ok(result.files.length >= 300, `${result.files.length} files`);
    assert.ok(folded.threshold > 2, "the first fold isn't already readable");
    assert.ok(folded.groups.length <= MAX_READABLE_NODES);
    assert.ok(foldAt(result.files, folded.threshold - 1).groups.length > MAX_READABLE_NODES, "lowest threshold");
  });

  test("layout is deterministic", () => {
    const open = new Set(["src/utils", "src/middleware"]);
    const once = layoutView(computeView(folded, stats, result.files, result.edges, open, "hono"));
    const twice = layoutView(computeView(fold(result.files), stats, result.files, result.edges, open, "hono"));
    assert.deepEqual([...once.boxes], [...twice.boxes]);
  });

  test("categories cover every file", () => {
    assert.equal(categoriesOf(result.files).reduce((n, c) => n + c.fileCount, 0), result.files.length);
  });
});
