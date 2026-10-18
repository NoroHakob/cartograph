import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { Project } from "ts-morph";
import { commonJsExports, esmExports } from "./exports.ts";
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

  test("ignores import types and export without from", () => {
    const r = parse({
      "a.js": "export { c }; let t; /** @type {import('./b').X} */ let x;",
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

/** Routes as "METHOD /path file:line", the way the route table reads. */
function routeLines(result: ParseResult): string[] {
  return result.routes.map((r) => `${r.methods.join(",")} ${r.path} ${r.file}${r.line === null ? "" : `:${r.line}`}`).sort();
}

function rolesOf(result: ParseResult): Record<string, string> {
  return Object.fromEntries(result.files.map((f) => [f.path, f.role]));
}

describe("framework detection", () => {
  test("runs in a fixed order and the first match wins", () => {
    const pkg = (deps: Record<string, string>) => JSON.stringify({ name: "x", dependencies: deps });
    assert.equal(parse({ "package.json": pkg({ next: "16", react: "19" }), "a.ts": "" }).adapter.id, "nextjs");
    assert.equal(parse({ "package.json": pkg({ "@nestjs/core": "11", react: "19" }), "a.ts": "" }).adapter.id, "nestjs");
    assert.equal(parse({ "package.json": pkg({ react: "19" }), "a.ts": "" }).adapter.id, "react");
    // A front end with its own small server is still a front end.
    assert.equal(parse({ "package.json": pkg({ express: "5", react: "19" }), "a.ts": "" }).adapter.id, "react");
    assert.equal(parse({ "package.json": pkg({ "@nestjs/core": "11", express: "5" }), "a.ts": "" }).adapter.id, "nestjs");
    assert.equal(parse({ "package.json": pkg({ express: "5" }), "a.ts": "" }).adapter.id, "express");
    // React only for tests is not a React codebase.
    assert.equal(parse({ "package.json": JSON.stringify({ devDependencies: { react: "19" } }), "a.ts": "" }).adapter.id, "none");
  });

  test("a small package in a corner doesn't decide what the repository is", () => {
    const library = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`src/f${i}.ts`, ""]));
    const bench = { "benchmarks/jsx/package.json": JSON.stringify({ dependencies: { react: "19" } }), "benchmarks/jsx/a.tsx": "" };
    assert.equal(parse({ "package.json": JSON.stringify({ name: "lib" }), ...library, ...bench }).adapter.id, "none");
    // The same app as a quarter of the repository does.
    const app = Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`apps/web/f${i}.tsx`, ""]));
    const web = { "apps/web/package.json": JSON.stringify({ dependencies: { react: "19" } }), ...app };
    assert.equal(parse({ "package.json": JSON.stringify({ name: "lib" }), ...library, ...web }).adapter.id, "react");
  });

  test("a repository matching nothing gets generic roles and no routes", () => {
    const r = parse({
      "package.json": JSON.stringify({ main: "src/index.ts" }),
      "src/index.ts": "",
      "src/util.ts": "",
      "src/util.test.ts": "",
      "vite.config.ts": "",
    });
    assert.deepEqual(rolesOf(r), { "src/index.ts": "entry", "src/util.test.ts": "test", "src/util.ts": "source", "vite.config.ts": "config" });
    assert.deepEqual(r.routes, []);
  });
});

describe("Next.js adapter", () => {
  const app = (files: Record<string, string>, config = "export default {};") => ({
    "package.json": JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } }),
    "next.config.ts": config,
    ...files,
  });

  test("roles come from path conventions and directives", () => {
    const r = parse(
      app({
        "app/page.tsx": "",
        "app/layout.tsx": "",
        "app/loading.tsx": "",
        "app/sitemap.ts": "",
        "app/(shop)/cart/page.tsx": "'use client';\nexport default function P() {}",
        "app/api/items/route.ts": "export function GET() {}",
        "app/actions.ts": "// actions\n'use server';\nexport async function save() {}",
        "app/_lib/page.tsx": "", // private: not a page
        "components/button.tsx": "",
        "components/menu.tsx": '"use client"',
        "lib/useCart.ts": "",
        "lib/db.ts": "function f() { 'use server'; }", // marks a function, not the file
        "proxy.ts": "",
        "instrumentation.ts": "",
        "app/page.test.tsx": "",
      }),
    );
    assert.equal(r.adapter.id, "nextjs");
    assert.deepEqual(rolesOf(r), {
      "app/page.tsx": "page",
      "app/layout.tsx": "layout",
      "app/loading.tsx": "route-ui",
      "app/sitemap.ts": "metadata",
      "app/(shop)/cart/page.tsx": "page",
      "app/api/items/route.ts": "api",
      "app/actions.ts": "server-action",
      "app/_lib/page.tsx": "component",
      "components/button.tsx": "component",
      "components/menu.tsx": "client-component",
      "lib/useCart.ts": "hook",
      "lib/db.ts": "other",
      "proxy.ts": "proxy",
      "instrumentation.ts": "instrumentation",
      "app/page.test.tsx": "test",
      "next.config.ts": "config",
    });
  });

  test("routes come from the same paths, and handlers list only what they export", () => {
    const r = parse(
      app({
        "app/page.tsx": "",
        "app/(shop)/cart/page.tsx": "",
        "app/blog/[slug]/page.tsx": "",
        "app/docs/[[...path]]/page.tsx": "",
        "app/%5Fnext/page.tsx": "",
        "app/_private/page.tsx": "",
        "app/@modal/page.tsx": "", // a slot: renders inside /, has no URL of its own
        "app/feed/(.)photo/[id]/page.tsx": "", // intercepting: depends on navigation
        "app/api/items/route.ts": "export async function GET() {}\nexport const POST = () => {};\nexport function helper() {}",
        "app/api/auth/route.ts": "import { handlers } from './auth';\nexport const { GET, POST } = handlers;",
        "app/api/auth/auth.ts": "export const handlers = {};",
        "app/api/reexport/route.ts": "export { GET } from '../items/route';",
        "app/api/star/route.ts": "export * from '../items/route';",
      }),
    );
    assert.deepEqual(routeLines(r), [
      "GET / app/page.tsx",
      "GET /_next app/%5Fnext/page.tsx",
      "GET /api/auth app/api/auth/route.ts:2",
      "GET /api/items app/api/items/route.ts:1",
      "GET /api/reexport app/api/reexport/route.ts:1",
      "GET /blog/[slug] app/blog/[slug]/page.tsx",
      "GET /cart app/(shop)/cart/page.tsx",
      "GET /docs/[[...path]] app/docs/[[...path]]/page.tsx",
      "POST /api/auth app/api/auth/route.ts:2",
      "POST /api/items app/api/items/route.ts:2",
    ]);
  });

  test("pages router: pages are routes, API routes have no method to state", () => {
    const r = parse(
      app({
        "src/pages/index.tsx": "",
        "src/pages/blog/[slug].tsx": "",
        "src/pages/_app.tsx": "",
        "src/pages/404.tsx": "",
        "src/pages/api/hello.ts": "export default function handler() {}",
      }),
    );
    assert.deepEqual(routeLines(r), ["GET / src/pages/index.tsx", "GET /blog/[slug] src/pages/blog/[slug].tsx"]);
    assert.equal(rolesOf(r)["src/pages/api/hello.ts"], "api");
    assert.equal(rolesOf(r)["src/pages/_app.tsx"], "layout");
  });

  test("a literal basePath is applied; anything next.config can't settle removes routes", () => {
    const files = { "app/page.tsx": "", "app/about/page.tsx": "" };
    assert.deepEqual(routeLines(parse(app(files, "export default { basePath: '/docs' };"))), [
      "GET /docs app/page.tsx",
      "GET /docs/about app/about/page.tsx",
    ]);
    assert.deepEqual(parse(app(files, "export default { basePath: process.env.BASE };")).routes, []);
    assert.deepEqual(parse(app(files, "export default { pageExtensions: ['page.tsx'] };")).routes, []);
    // Roles don't depend on it.
    assert.equal(rolesOf(parse(app(files, "export default { basePath: process.env.BASE };")))["app/about/page.tsx"], "page");
  });
});

describe("NestJS adapter", () => {
  const nest = (files: Record<string, string>) => ({
    "package.json": JSON.stringify({ dependencies: { "@nestjs/core": "11.0.0", "@nestjs/common": "11.0.0" } }),
    ...files,
  });
  const controller = [
    "import { Controller, Get, Post, Delete as Remove } from '@nestjs/common';",
    "@Controller('users')",
    "export class UsersController {",
    "  @Get()",
    "  list() {}",
    "  @Get(':id')",
    "  one() {}",
    "  @Post(['', 'bulk'])",
    "  create() {}",
    "  @Remove('/:id/')",
    "  remove() {}",
    "  @Get(PATH)",
    "  computed() {}",
    "  helper() {}",
    "}",
  ].join("\n");

  test("roles come from file name suffixes", () => {
    const r = parse(
      nest({
        "src/users/users.controller.ts": "",
        "src/users/users.service.ts": "",
        "src/users/users.module.ts": "",
        "src/users/user.entity.ts": "",
        "src/users/dto/create-user.dto.ts": "",
        "src/users/users.controller.spec.ts": "",
        "src/main.ts": "",
        "test/app.e2e-spec.ts": "",
      }),
    );
    assert.equal(r.adapter.id, "nestjs");
    assert.deepEqual(rolesOf(r), {
      "src/main.ts": "other",
      "src/users/dto/create-user.dto.ts": "dto",
      "src/users/user.entity.ts": "entity",
      "src/users/users.controller.spec.ts": "test",
      "src/users/users.controller.ts": "controller",
      "src/users/users.module.ts": "module",
      "src/users/users.service.ts": "service",
      "test/app.e2e-spec.ts": "test",
    });
  });

  test("routes join the controller's path and the method's, under a literal global prefix", () => {
    const r = parse(
      nest({
        "src/users/users.controller.ts": controller,
        "src/main.ts": "const app = await NestFactory.create(AppModule);\napp.setGlobalPrefix('api');",
        "src/health.controller.ts": "import * as common from '@nestjs/common';\n@common.Controller()\nexport class H {\n  @common.Get('health') check() {}\n}",
        "src/other.controller.ts": "import { Controller, Get } from './not-nest';\n@Controller('x')\nexport class O { @Get() a() {} }",
        "src/computed.controller.ts": "import { Controller, Get } from '@nestjs/common';\n@Controller(BASE)\nexport class C { @Get() a() {} }",
        "src/host.controller.ts":
          "import { Controller, Get } from '@nestjs/common';\n@Controller({ path: 'h', host: 'admin.example.com' })\nexport class C { @Get() a() {} }",
        "src/versioned.controller.ts":
          "import { Controller, Get, Version } from '@nestjs/common';\n@Controller('v')\nexport class V { @Version('2') @Get() a() {} @Get('b') b() {} }",
      }),
    );
    assert.deepEqual(routeLines(r), [
      "DELETE /api/users/:id src/users/users.controller.ts:10",
      "GET /api/health src/health.controller.ts:4",
      "GET /api/users src/users/users.controller.ts:4",
      "GET /api/users/:id src/users/users.controller.ts:6",
      "GET /api/v/b src/versioned.controller.ts:3",
      "POST /api/users src/users/users.controller.ts:8",
      "POST /api/users/bulk src/users/users.controller.ts:8",
    ]);
  });

  test("no routes when something outside the decorators moves every path", () => {
    const files = { "src/users/users.controller.ts": controller };
    assert.equal(parse(nest(files)).routes.length, 5);
    const routesWith = (main: string) => parse(nest({ ...files, "src/main.ts": main })).routes;
    assert.deepEqual(routesWith("app.setGlobalPrefix(PREFIX);"), []);
    assert.deepEqual(routesWith("app.setGlobalPrefix('api', { exclude: ['health'] });"), []);
    assert.deepEqual(routesWith("app.enableVersioning({ type: VersioningType.URI });"), []);
    assert.deepEqual(routesWith("import { RouterModule } from '@nestjs/core';"), []);
  });
});

describe("React adapter", () => {
  test("components and hooks by name; React routes nothing", () => {
    const r = parse({
      "package.json": JSON.stringify({ dependencies: { react: "19.0.0" } }),
      "src/App.tsx": "",
      "src/useThing.ts": "",
      "src/api.ts": "",
    });
    assert.equal(r.adapter.id, "react");
    assert.deepEqual(rolesOf(r), { "src/App.tsx": "component", "src/api.ts": "other", "src/useThing.ts": "hook" });
    assert.deepEqual(r.routes, []);
  });
});

describe("CommonJS", () => {
  test("require() with a literal argument is collected and resolved like an import", () => {
    const r = parse({
      "package.json": JSON.stringify({ name: "x", dependencies: { debug: "4" } }),
      "lib/a.js": [
        "const b = require('./b');",
        "const dir = require(`./dir`);",
        "const fs = require('fs');",
        "const debug = require('debug')('x');",
        "const missing = require('./nope');",
        "const up = require('..');",
      ].join("\n"),
      "lib/b.js": "",
      "lib/dir/index.js": "",
      "index.js": "",
    });
    assert.deepEqual(
      importsFrom(r, "lib/a.js").map((i) => [i.specifier, i.kind, i.line, i.resolution]),
      [
        ["./b", "require", 1, { status: "internal", target: "lib/b.js" }],
        ["./dir", "require", 2, { status: "internal", target: "lib/dir/index.js" }],
        ["fs", "require", 3, { status: "external", kind: "builtin" }],
        ["debug", "require", 4, { status: "external", kind: "package", packageName: "debug", installed: false }],
        ["./nope", "require", 5, { status: "unresolved", reason: "file-not-found" }],
        ["..", "require", 6, { status: "internal", target: "index.js" }],
      ],
    );
    assert.equal(r.coverage.total, 6);
    assert.equal(r.edges.length, 3);
  });

  test("only a literal require() is collected: not require(expr), require.resolve, or a local require", () => {
    const r = parse({
      "a.js": "const n = './b'; require(n); require.resolve('./b'); require('./b', 1); require();",
      "shadowed.js": "function load(require) { return require('./b'); }",
      "own.js": "const require = (p) => p; require('./b');",
      "esm.mjs": "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); require('./b');",
      "typed.ts": "declare const require: (id: string) => unknown; require('./b');",
      "b.js": "",
    });
    assert.equal(importsFrom(r, "a.js").length, 0);
    assert.equal(importsFrom(r, "shadowed.js").length, 0);
    assert.equal(importsFrom(r, "own.js").length, 0);
    assert.deepEqual(
      importsFrom(r, "esm.mjs").map((i) => [i.specifier, i.kind]),
      [
        ["node:module", "static"],
        ["./b", "require"],
      ],
    );
    assert.deepEqual(
      importsFrom(r, "typed.ts").map((i) => [i.specifier, i.kind]),
      [["./b", "require"]],
    );
  });

  test("a file mixing require() and import reports both, without duplicates", () => {
    const r = parse({
      "a.ts": ["import b from './b';", "import c = require('./c');", "const b2 = require('./b');", "const d = require('./d');"].join("\n"),
      "b.ts": "",
      "c.ts": "",
      "d.ts": "",
    });
    assert.deepEqual(
      importsFrom(r, "a.ts").map((i) => [i.specifier, i.kind, i.line]),
      [
        ["./b", "static", 1],
        ["./c", "static", 2],
        ["./b", "require", 3],
        ["./d", "require", 4],
      ],
    );
    assert.deepEqual(
      r.edges.map((e) => [e.target, e.kinds, e.occurrences]),
      [
        ["b.ts", ["require", "static"], 2],
        ["c.ts", ["static"], 1],
        ["d.ts", ["require"], 1],
      ],
    );
  });

  test("require() picks the require condition, import picks import", () => {
    const r = parse({
      "package.json": JSON.stringify({ name: "x", imports: { "#impl": { require: "./impl.cjs", import: "./impl.mjs" } } }),
      "a.mjs": "import x from '#impl'; const y = require('#impl');",
      "impl.cjs": "",
      "impl.mjs": "",
    });
    assert.deepEqual(
      importsFrom(r, "a.mjs").map((i) => [i.kind, i.resolution]),
      [
        ["static", { status: "internal", target: "impl.mjs" }],
        ["require", { status: "internal", target: "impl.cjs" }],
      ],
    );
  });

  test("the names a module exports, both ways", () => {
    const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true, compilerOptions: { allowJs: true } });
    const read = (text: string) => commonJsExports(project.createSourceFile("/m.js", text, { overwrite: true }))?.map((n) => `${n.name}:${n.line}`) ?? null;
    assert.deepEqual(read("exports.a = 1;\nmodule.exports.b = 2;\nexports['c'] = 3;\nObject.defineProperty(exports, 'd', { value: 4 });"), ["a:1", "b:2", "c:3", "d:4"]);
    assert.deepEqual(read("module.exports = { a, b: 1, 'c': 2, d() {} };"), ["a:1", "b:1", "c:1", "d:1"]);
    // Express's own lib/express.js.
    assert.deepEqual(read("exports = module.exports = createApplication;\nexports.application = proto;"), ["default:1", "application:2"]);
    assert.deepEqual(read("exports.a = exports.b = fn;"), ["a:1", "b:1"]);
    // Only top-level statements, and only the real exports object.
    assert.deepEqual(read("if (x) { exports.hidden = 1; } const exportsLike = {}; exportsLike.a = 1; foo.exports = 2;"), []);
    // Unreadable from this file alone.
    assert.equal(read("module.exports = require('./other');"), null);
    assert.equal(read("module.exports = { ...base, a };"), null);
    assert.equal(read("module.exports = { [key]: 1 };"), null);

    const esm = (text: string) => esmExports(project.createSourceFile("/m.ts", text, { overwrite: true }))?.map((n) => n.name) ?? null;
    assert.deepEqual(esm("export const GET = 1; export function POST() {} export { x as PUT }; export type T = 1;"), ["GET", "POST", "PUT"]);
    assert.equal(esm("export * from './x';"), null);
  });
});

describe("Express adapter", () => {
  const app = (files: Record<string, string>) => ({
    "package.json": JSON.stringify({ name: "api", main: "src/index.js", dependencies: { express: "5.0.0" } }),
    ...files,
  });

  test("roles come from directory names, singular or plural", () => {
    const r = parse(
      app({
        "src/index.js": "const app = require('./app'); app.listen(3000);",
        "src/app.js": "const express = require('express'); const routes = require('./routes/v1'); module.exports = express();",
        "src/routes/v1/index.js": "const router = require('express').Router(); router.use('/users', require('./user.route')); module.exports = router;",
        "src/routes/v1/user.route.js": "const c = require('../../controllers/user.controller'); const auth = require('../../middlewares/auth');",
        "src/router/admin.js": "",
        "src/controllers/user.controller.js": "const s = require('../services'); module.exports = { list: s.list };",
        "src/controller/legacy.js": "",
        "src/services/index.js": "",
        "src/service/mail.js": "",
        "src/models/user.model.js": "",
        "src/model/token.js": "",
        "src/middlewares/auth.js": "",
        "src/middleware/error.js": "",
        "src/routes/middleware/rate.js": "",
        "src/config/config.js": "",
        "src/utils/pick.js": "",
        "tests/user.test.js": "",
      }),
    );
    assert.equal(r.adapter.id, "express");
    assert.deepEqual(rolesOf(r), {
      "src/app.js": "other",
      "src/config/config.js": "config",
      "src/controller/legacy.js": "controller",
      "src/controllers/user.controller.js": "controller",
      "src/index.js": "entry",
      "src/middleware/error.js": "middleware",
      "src/middlewares/auth.js": "middleware",
      "src/model/token.js": "model",
      "src/models/user.model.js": "model",
      "src/router/admin.js": "route",
      "src/routes/middleware/rate.js": "middleware",
      "src/routes/v1/index.js": "route",
      "src/routes/v1/user.route.js": "route",
      "src/service/mail.js": "service",
      "src/services/index.js": "service",
      "src/utils/pick.js": "other",
      "tests/user.test.js": "test",
    });
    // The graph is real even though no route is extracted.
    const has = (source: string, target: string) => r.edges.some((e) => e.source === source && e.target === target);
    assert.ok(has("src/routes/v1/user.route.js", "src/controllers/user.controller.js"));
    assert.ok(has("src/routes/v1/user.route.js", "src/middlewares/auth.js"));
    assert.ok(has("src/controllers/user.controller.js", "src/services/index.js"));
  });

  test("routes are never extracted, however literal they look", () => {
    const r = parse(
      app({
        "src/index.js": "const express = require('express'); const app = express(); app.get('/health', (req, res) => res.send('ok')); app.listen(3000);",
        "src/routes/users.js": "const router = require('express').Router(); router.post('/', create); module.exports = router;",
      }),
    );
    assert.equal(r.adapter.id, "express");
    assert.deepEqual(r.routes, []);
  });

  test("conventional directory names count only inside an Express package", () => {
    const r = parse({
      "package.json": JSON.stringify({ name: "mono" }),
      "server/package.json": JSON.stringify({ name: "server", dependencies: { express: "5" } }),
      "server/routes/a.js": "",
      "server/models/b.js": "",
      "tools/package.json": JSON.stringify({ name: "tools" }),
      "tools/models/c.js": "",
    });
    assert.equal(r.adapter.id, "express");
    assert.deepEqual(rolesOf(r), { "server/models/b.js": "model", "server/routes/a.js": "route", "tools/models/c.js": "other" });
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
    writeParseResult({ ...r, version: 1 as unknown as 2 }, file);
    assert.throws(() => readParseResult(file), /version 2/);
  });
});
