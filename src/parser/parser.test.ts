import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { parseRepository } from "./index.ts";
import { checkInvariants, readParseResult, writeParseResult } from "./output.ts";
import type { ImportRecord, ParseResult, Resolution } from "./types.ts";
import { countLines } from "./walk.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** Writes a throwaway repository and parses it. */
function parse(files: Record<string, string>): ParseResult {
  const root = mkdtempSync(path.join(tmpdir(), "cartograph-"));
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  const result = parseRepository(root);
  assert.deepEqual(checkInvariants(result), [], "invariants");
  return result;
}

function resolutionOf(result: ParseResult, source: string, specifier: string): Resolution {
  const found = result.imports.find((i) => i.source === source && i.specifier === specifier);
  assert.ok(found, `no import of ${specifier} in ${source}`);
  return found.resolution;
}

function importsFrom(result: ParseResult, source: string): ImportRecord[] {
  return result.imports.filter((i) => i.source === source);
}

describe("walking", () => {
  test("counts lines and hashes contents", () => {
    assert.equal(countLines(""), 0);
    assert.equal(countLines("a"), 1);
    assert.equal(countLines("a\n"), 1);
    assert.equal(countLines("a\nb"), 2);
    assert.equal(countLines("a\r\nb\r\n"), 2);

    const r = parse({ "a.ts": "one\ntwo\nthree\n", "b.ts": "one\ntwo\nthree\n" });
    const [a, b] = r.files;
    assert.equal(a.lineCount, 3);
    assert.match(a.hash, /^[0-9a-f]{64}$/);
    assert.equal(a.hash, b.hash);
  });

  test("keeps whole directories, honours .gitignore and skips node_modules", () => {
    const r = parse({
      ".gitignore": "dist/\n*.gen.ts\n",
      "src/a.ts": "import './b';",
      "src/b.ts": "",
      "src/c.gen.ts": "",
      "dist/out.js": "",
      "node_modules/pkg/index.js": "",
      "README.md": "",
    });
    assert.deepEqual(r.files.map((f) => f.path), ["src/a.ts", "src/b.ts"]);
  });

  test("records excluded source files with a reason", () => {
    const r = parse({
      "a.ts": "import './types'; import './vendor.min.js';",
      "types.d.ts": "export {};",
      "vendor.min.js": "",
    });
    assert.deepEqual(r.files.map((f) => f.path), ["a.ts"]);
    assert.deepEqual(r.excludedFiles, [
      { path: "types.d.ts", reason: "declaration-file" },
      { path: "vendor.min.js", reason: "minified" },
    ]);
    assert.deepEqual(resolutionOf(r, "a.ts", "./types"), { status: "excluded", reason: "declaration-file", target: "types.d.ts" });
    assert.deepEqual(resolutionOf(r, "a.ts", "./vendor.min.js"), { status: "excluded", reason: "minified", target: "vendor.min.js" });
  });

  test("a module is the nearest package.json", () => {
    const r = parse({
      "package.json": JSON.stringify({ name: "root" }),
      "tools/x.ts": "",
      "packages/ui/package.json": JSON.stringify({ name: "@acme/ui" }),
      "packages/ui/src/button.ts": "",
    });
    assert.deepEqual(
      r.modules.map((m) => [m.dir, m.name, m.fileCount]),
      [
        [".", "root", 1],
        ["packages/ui", "@acme/ui", 1],
      ],
    );
    assert.equal(r.files.find((f) => f.path === "packages/ui/src/button.ts")?.module, "packages/ui");
  });
});

describe("imports become edges", () => {
  test("plain import, re-export and literal dynamic import", () => {
    const r = parse({
      "a.ts": [
        "import x from './b';",
        "import './side';",
        "export * from './c';",
        "export { y } from './d';",
        "const m = import('./e');",
        "const t = import(`./f`);",
        "import g = require('./g');",
      ].join("\n"),
      "b.ts": "",
      "side.ts": "",
      "c.ts": "",
      "d.ts": "",
      "e.ts": "",
      "f.ts": "",
      "g.ts": "",
    });
    assert.deepEqual(
      importsFrom(r, "a.ts").map((i) => [i.specifier, i.kind, i.line, i.resolution.status]),
      [
        ["./b", "static", 1, "internal"],
        ["./side", "static", 2, "internal"],
        ["./c", "reexport", 3, "internal"],
        ["./d", "reexport", 4, "internal"],
        ["./e", "dynamic", 5, "internal"],
        ["./f", "dynamic", 6, "internal"],
        ["./g", "static", 7, "internal"],
      ],
    );
    assert.equal(r.edges.length, 7);
  });

  test("a dynamic import of an expression is unresolved, not dropped", () => {
    const r = parse({ "a.ts": "const name = 'b'; import(`./${name}`); import(name);", "b.ts": "" });
    const dynamic = importsFrom(r, "a.ts");
    assert.equal(dynamic.length, 2);
    for (const d of dynamic) assert.deepEqual(d.resolution, { status: "unresolved", reason: "non-literal-specifier" });
    assert.equal(r.edges.length, 0);
    assert.equal(r.coverage.unresolvedByReason["non-literal-specifier"]?.count, 2);
  });

  test("type-only imports are marked", () => {
    const r = parse({
      "a.ts": "import type { T } from './b'; import { type U } from './c'; import { type V, w } from './d';",
      "b.ts": "",
      "c.ts": "",
      "d.ts": "",
    });
    assert.deepEqual(
      importsFrom(r, "a.ts").map((i) => i.typeOnly),
      [true, true, false],
    );
  });

  test("ignores require(), import types and export without from", () => {
    const r = parse({
      "a.js": "const b = require('./b'); export { c }; let t; /** @type {import('./b').X} */ let x;",
      "b.js": "",
    });
    assert.equal(importsFrom(r, "a.js").length, 0);
  });

  test("resolves .js specifiers to .ts sources, index files and JS repos", () => {
    const r = parse({
      "src/a.ts": "import './b.js'; import './dir';",
      "src/b.ts": "",
      "src/dir/index.ts": "",
      "lib/x.mjs": "import './y.mjs'; import y from './z';",
      "lib/y.mjs": "",
      "lib/z.jsx": "export default 1",
    });
    assert.deepEqual(resolutionOf(r, "src/a.ts", "./b.js"), { status: "internal", target: "src/b.ts" });
    assert.deepEqual(resolutionOf(r, "src/a.ts", "./dir"), { status: "internal", target: "src/dir/index.ts" });
    assert.deepEqual(resolutionOf(r, "lib/x.mjs", "./y.mjs"), { status: "internal", target: "lib/y.mjs" });
    assert.deepEqual(resolutionOf(r, "lib/x.mjs", "./z"), { status: "internal", target: "lib/z.jsx" });
  });

  test("a checked-in .d.ts leads to the .js beside it", () => {
    const r = parse({ "a.ts": "import './lib';", "lib.js": "", "lib.d.ts": "export {};" });
    assert.deepEqual(resolutionOf(r, "a.ts", "./lib"), { status: "internal", target: "lib.js" });
  });
});

describe("fan-in and fan-out", () => {
  test("are computed after duplicates are removed", () => {
    const r = parse({
      "a.ts": "import './c'; import { x } from './c'; export * from './c'; import('./c');",
      "b.ts": "import './c';",
      "c.ts": "import './a';",
    });
    const edge = r.edges.find((e) => e.source === "a.ts" && e.target === "c.ts");
    assert.deepEqual(edge, { source: "a.ts", target: "c.ts", kinds: ["dynamic", "reexport", "static"], typeOnly: false, occurrences: 4 });
    assert.equal(r.edges.length, 3);
    assert.equal(r.stats.duplicateImportsCollapsed, 3);
    const byPath = Object.fromEntries(r.files.map((f) => [f.path, [f.fanIn, f.fanOut]]));
    assert.deepEqual(byPath, { "a.ts": [1, 1], "b.ts": [0, 1], "c.ts": [2, 1] });
  });

  test("an edge is type-only only when every import in it is", () => {
    const r = parse({ "a.ts": "import type { T } from './b'; import { v } from './b';", "b.ts": "" });
    assert.equal(r.edges[0].typeOnly, false);
  });
});

describe("coverage", () => {
  test("classifies every import and keeps examples of failures", () => {
    const r = parse({
      "package.json": JSON.stringify({ name: "app", dependencies: { react: "19", "@scope/lib": "1" } }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
      "src/a.ts": [
        "import './b';", // internal
        "import '@/b';", // internal via paths
        "import '@/missing';", // alias-target-not-found
        "import './gone';", // file-not-found
        "import 'react';", // external, declared
        "import '@scope/lib/sub';", // external, declared
        "import 'fs';", // builtin
        "import 'node:path';", // builtin
        "import 'left-pad';", // undeclared-package
        "import '~/thing';", // unknown-alias: "~" can't start a package name
        "import '@/';", // alias-target-not-found
        "import '#internal';", // subpath-import-not-found
        "import './style.css';", // excluded: non-source-file
        "import 'https://esm.sh/x';", // url
        "import '../../outside';", // file-not-found, leaves the repository
      ].join("\n"),
      "src/b.ts": "",
      "src/style.css": "",
    });
    const status = (s: string) => resolutionOf(r, "src/a.ts", s);
    assert.deepEqual(status("./b"), { status: "internal", target: "src/b.ts" });
    assert.deepEqual(status("@/b"), { status: "internal", target: "src/b.ts" });
    assert.equal((status("@/missing") as { reason: string }).reason, "alias-target-not-found");
    assert.equal((status("./gone") as { reason: string }).reason, "file-not-found");
    assert.deepEqual(status("react"), { status: "external", kind: "package", packageName: "react", installed: false });
    assert.deepEqual(status("@scope/lib/sub"), { status: "external", kind: "package", packageName: "@scope/lib", installed: false });
    assert.deepEqual(status("fs"), { status: "external", kind: "builtin" });
    assert.deepEqual(status("node:path"), { status: "external", kind: "builtin" });
    assert.equal((status("left-pad") as { reason: string }).reason, "undeclared-package");
    assert.equal((status("#internal") as { reason: string }).reason, "subpath-import-not-found");
    assert.equal((status("~/thing") as { reason: string }).reason, "unknown-alias");
    assert.deepEqual(status("./style.css"), { status: "excluded", reason: "non-source-file", target: "src/style.css" });
    assert.deepEqual(status("https://esm.sh/x"), { status: "external", kind: "url" });
    assert.equal((status("../../outside") as { reason: string }).reason, "file-not-found");

    assert.equal(r.coverage.total, 15);
    assert.equal(r.coverage.internal, 2);
    assert.equal(r.coverage.unresolved, 7);
    const missing = r.coverage.unresolvedByReason["file-not-found"];
    assert.deepEqual(missing?.examples[0], { source: "src/a.ts", line: 4, specifier: "./gone" });
  });

  test("a specifier that can't be a package and matches no alias is an unknown alias", () => {
    const r = parse({ "a.ts": "import '@/thing'; import 'UPPER';" });
    assert.equal((resolutionOf(r, "a.ts", "@/thing") as { reason: string }).reason, "unknown-alias");
    assert.equal((resolutionOf(r, "a.ts", "UPPER") as { reason: string }).reason, "unknown-alias");
  });

  test("an import into a gitignored path is excluded", () => {
    const r = parse({ ".gitignore": "generated/\n", "a.ts": "import './generated/api';", "generated/api.ts": "" });
    assert.deepEqual(resolutionOf(r, "a.ts", "./generated/api"), { status: "excluded", reason: "ignored-path", target: "generated/api.ts" });
  });
});

describe("tsconfig", () => {
  test("uses the config that includes the file, not just the nearest one", () => {
    const r = parse({
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
      "tsconfig.app.json": JSON.stringify({ compilerOptions: { paths: { "~app/*": ["./src/*"] } }, include: ["src"] }),
      "src/a.ts": "import '~app/b';",
      "src/b.ts": "",
    });
    assert.deepEqual(resolutionOf(r, "src/a.ts", "~app/b"), { status: "internal", target: "src/b.ts" });
  });

  test("reports a broken config and carries on", () => {
    const r = parse({ "tsconfig.json": "{ not json", "a.ts": "import './b';", "b.ts": "" });
    assert.equal(r.configNotes.length > 0, true);
    assert.equal(resolutionOf(r, "a.ts", "./b").status, "internal");
  });
});

describe("workspaces", () => {
  test("a bare import of a package in this repo resolves inside it", () => {
    const r = parse({
      "package.json": JSON.stringify({ name: "mono", workspaces: ["packages/*"] }),
      "packages/app/package.json": JSON.stringify({ name: "app", dependencies: { "@acme/ui": "*" } }),
      "packages/app/main.ts": "import '@acme/ui'; import '@acme/ui/button'; import '@acme/core';",
      "packages/ui/package.json": JSON.stringify({ name: "@acme/ui", main: "index.ts" }),
      "packages/ui/index.ts": "",
      "packages/ui/button.ts": "",
      "packages/core/package.json": JSON.stringify({ name: "@acme/core", main: "dist/index.js" }),
      "packages/core/src/index.ts": "",
    });
    const s = (spec: string) => resolutionOf(r, "packages/app/main.ts", spec);
    assert.deepEqual(s("@acme/ui"), { status: "internal", target: "packages/ui/index.ts" });
    assert.deepEqual(s("@acme/ui/button"), { status: "internal", target: "packages/ui/button.ts" });
    // Its entry points at a build output that isn't there: reported, not guessed at src/.
    assert.equal((s("@acme/core") as { reason: string }).reason, "workspace-entry-not-found");
  });
});

describe("adapter", () => {
  test("the fallback reads entry points from package.json only", () => {
    const r = parse({
      "package.json": JSON.stringify({ name: "x", main: "./src/index", bin: { x: "bin/cli.js" }, exports: { ".": { import: "./dist/x.mjs" } } }),
      "src/index.ts": "",
      "bin/cli.js": "",
    });
    assert.equal(r.adapter.id, "none");
    assert.deepEqual(r.routes, []);
    assert.deepEqual(r.entryPoints, [
      { path: "src/index.ts", origin: "package.json#main", declared: "./src/index" },
      { path: "bin/cli.js", origin: "package.json#bin", declared: "bin/cli.js" },
      { path: null, origin: "package.json#exports", declared: "./dist/x.mjs" },
    ]);
  });
});

describe("output", () => {
  test("round-trips through the data file and rejects broken data", () => {
    const r = parse({ "a.ts": "import './b';", "b.ts": "" });
    const dir = mkdtempSync(path.join(tmpdir(), "cartograph-out-"));
    made.push(dir);
    const file = path.join(dir, "result.json");
    writeParseResult(r, file);
    assert.deepEqual(readParseResult(file), r);

    writeParseResult({ ...r, files: r.files.filter((f) => f.path !== "b.ts") }, file);
    assert.throws(() => readParseResult(file), /invariant/);
    writeParseResult({ ...r, version: 2 as unknown as 1 }, file);
    assert.throws(() => readParseResult(file), /version 1/);
  });
});
