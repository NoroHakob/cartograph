import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { gzipSync } from "node:zlib";
import { Header } from "tar";
import { parseRepository } from "@/parser";
import { parseRepoUrl } from "./github";
import { selectFromArchive } from "./select";
import { isStale, STALE_AFTER_MS } from "./stale";

describe("parseRepoUrl", () => {
  test("reads owner and name from the forms people paste", () => {
    const want = { owner: "honojs", name: "hono" };
    for (const input of [
      "https://github.com/honojs/hono",
      "https://github.com/honojs/hono/",
      "https://github.com/honojs/hono.git",
      "https://www.github.com/honojs/hono/tree/main/src",
      "http://github.com/honojs/hono?tab=readme",
      "github.com/honojs/hono",
      "git@github.com:honojs/hono.git",
      "  honojs/hono  ",
    ]) {
      assert.deepEqual(parseRepoUrl(input), want, input);
    }
    assert.deepEqual(parseRepoUrl("vercel/next.js"), { owner: "vercel", name: "next.js" });
  });

  test("refuses anything that isn't a GitHub repository", () => {
    for (const input of ["", "hono", "https://gitlab.com/a/b", "https://github.com/honojs", "a/..", "-bad/name", "a b/c"]) {
      assert.equal(parseRepoUrl(input), null, input);
    }
  });
});

describe("selectFromArchive", () => {
  const work = mkdtempSync(path.join(tmpdir(), "cartograph-test-"));
  after(() => rmSync(work, { recursive: true, force: true }));
  let n = 0;

  /** A GitHub-shaped tarball: everything under one "<owner>-<repo>-<sha>/" directory. */
  const archive = (entries: { path: string; body?: string; type?: "File" | "SymbolicLink" | "Directory"; linkpath?: string }[]) => {
    const blocks: Buffer[] = [];
    for (const e of [{ path: "", type: "Directory" as const }, ...entries]) {
      const body = Buffer.from(e.body ?? "");
      const type = e.type ?? "File";
      const header = new Header({
        path: `acme-repo-abc1234/${e.path}`,
        type,
        size: type === "File" ? body.length : 0,
        mode: type === "Directory" ? 0o755 : 0o644,
        mtime: new Date(0),
        linkpath: e.linkpath,
      });
      header.encode();
      blocks.push(header.block!);
      if (type === "File" && body.length > 0) blocks.push(body, Buffer.alloc((512 - (body.length % 512)) % 512));
    }
    blocks.push(Buffer.alloc(1024));
    const file = path.join(work, `archive-${n}.tar.gz`);
    writeFileSync(file, gzipSync(Buffer.concat(blocks)));
    const dest = path.join(work, `out-${n++}`, "repo");
    return { file, dest };
  };

  test("writes what the parser reads, and empty placeholders for the rest", async () => {
    const { file, dest } = archive([
      { path: "package.json", body: '{"name":"repo"}' },
      { path: "src/index.ts", body: 'import "./styles.css";\nexport * from "./lib";\n' },
      { path: "src/lib.ts", body: "export const x = 1;\n" },
      { path: "src/styles.css", body: "body { color: red }\n" },
      { path: "logo.png", body: "\u0089PNG" },
    ]);
    const selection = await selectFromArchive(file, dest);

    assert.deepEqual(selection, { entries: 5, kept: 3, placeholders: 2, skipped: { count: 0, examples: [] } });
    assert.equal(readFileSync(path.join(dest, "src/lib.ts"), "utf8"), "export const x = 1;\n");
    assert.equal(readFileSync(path.join(dest, "src/styles.css"), "utf8"), "");

    // The placeholder still exists, so the stylesheet import is excluded as
    // non-source rather than reported missing.
    const result = parseRepository(dest);
    assert.equal(result.files.length, 2);
    assert.equal(result.coverage.unresolved, 0);
    assert.equal(result.coverage.excluded, 1);
    assert.equal(result.edges.length, 1);
  });

  test("never writes links or paths that leave the destination, and says so", async () => {
    const { file, dest } = archive([
      { path: "src/index.ts", body: "export {};\n" },
      { path: "src/alias.ts", type: "SymbolicLink", linkpath: "../../outside.ts" },
      { path: "../escape.ts", body: "export {};\n" },
    ]);
    const selection = await selectFromArchive(file, dest);

    assert.equal(selection.kept, 1);
    assert.deepEqual(
      selection.skipped.examples.map((e) => e.reason).sort(),
      ["link", "unsafe-path"],
    );
    assert.equal(existsSync(path.join(dest, "src/alias.ts")), false);
    assert.equal(existsSync(path.join(dest, "..", "escape.ts")), false);
  });

  test("refuses an archive with no files", async () => {
    const { file, dest } = archive([]);
    await assert.rejects(selectFromArchive(file, dest), /no files/);
  });
});

describe("isStale", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  test("an unfinished run whose stage hasn't moved for a while is stale", () => {
    assert.equal(isStale({ status: "parsing", stage_at: ago(STALE_AFTER_MS + 1000), created_at: ago(STALE_AFTER_MS * 2) }, now), true);
    assert.equal(isStale({ status: "parsing", stage_at: ago(1000), created_at: ago(STALE_AFTER_MS * 2) }, now), false);
    assert.equal(isStale({ status: "queued", stage_at: null, created_at: ago(STALE_AFTER_MS + 1000) }, now), true);
  });

  test("a finished run is never stale", () => {
    for (const status of ["complete", "failed"]) {
      assert.equal(isStale({ status, stage_at: ago(STALE_AFTER_MS * 10), created_at: ago(STALE_AFTER_MS * 10) }, now), false);
    }
  });
});
