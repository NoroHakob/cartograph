import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { gzipSync } from "node:zlib";
import { Header } from "tar";
import { parseRepository } from "@/parser";
import { isTimeout } from "./errors";
import { downloadArchive, parseRepoUrl } from "./github";
import type { Claim, RunOptions, RunOutcome } from "./run";
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

describe("GitHub timeouts", () => {
  test("a download whose body stalls fails as a timeout", async () => {
    const real = globalThis.fetch;
    // Headers arrive, then nothing: the body never ends and never errors.
    globalThis.fetch = async () => new Response(new ReadableStream({ pull: () => new Promise(() => {}) }));
    const dir = mkdtempSync(path.join(tmpdir(), "cartograph-timeout-"));
    try {
      const snapshot = { owner: "o", name: "n", defaultBranch: "main", commitSha: "a".repeat(40) };
      const error = await downloadArchive(snapshot, path.join(dir, "a.tar.gz"), AbortSignal.timeout(50)).then(
        () => null,
        (e: unknown) => e,
      );
      // The stream pipeline wraps the timeout in an AbortError; it still counts.
      assert.ok(isTimeout(error), `expected a timeout, got ${String(error)}`);
    } finally {
      globalThis.fetch = real;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("isTimeout tells a deadline from any other abort", () => {
    assert.equal(isTimeout(new DOMException("late", "TimeoutError")), true);
    assert.equal(isTimeout(Object.assign(new Error("aborted"), { name: "AbortError", cause: new DOMException("late", "TimeoutError") })), true);
    assert.equal(isTimeout(new DOMException("stopped", "AbortError")), false);
    assert.equal(isTimeout(new Error("TimeoutError")), false);
  });
});

describe("run ownership", () => {
  type Row = Record<string, unknown>;

  /**
   * The analyses table as far as a run writes it: update().eq()...select()
   * changes the row only when every filter matches, and returns the rows it
   * changed, as PostgREST does.
   */
  function fakeDb(row: Row) {
    const db = {
      from: () => ({
        update: (values: Row) => {
          const filters: [string, unknown][] = [];
          const query = {
            eq: (column: string, value: unknown) => (filters.push([column, value]), query),
            select: async () => {
              const hit = filters.every(([column, value]) => row[column] === value);
              if (hit) Object.assign(row, values);
              return { data: hit ? [{ id: row.id }] : [], error: null };
            },
          };
          return query;
        },
      }),
    };
    // Only the calls runClaimed makes before storing are implemented.
    return db as unknown as NonNullable<RunOptions["db"]>;
  }

  /**
   * run.ts loads the admin client's environment checks on import. These tests
   * pass their own db, so no client is ever made; placeholders satisfy the
   * checks without reading .env.local.
   */
  async function runClaimed(claim: Claim, options: RunOptions): Promise<RunOutcome> {
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://supabase.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "placeholder";
    process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ??= "/sign-in";
    const run = await import("./run");
    return run.runClaimed(claim, options);
  }

  /** GitHub, answering lookups normally and the tarball with `tarball`. */
  async function withGitHub<T>(tarball: () => Response, body: () => Promise<T>): Promise<T> {
    const real = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/repos/o/n")) return Response.json({ full_name: "o/n", default_branch: "main" });
      if (url.includes("/commits/")) return new Response("b".repeat(40));
      if (url.includes("/tarball/")) return tarball();
      return new Response(null, { status: 500, statusText: "unexpected" });
    };
    try {
      return await body();
    } finally {
      globalThis.fetch = real;
    }
  }

  const claimA = { analysisId: "an-1", runId: "run-A", repo: { owner: "o", name: "n" } };
  /** The row as run B's claim left it. */
  const claimedByB = { run_id: "run-B", status: "parsing", stage: "fetch", stage_message: "Starting", error: null };

  test("a run that failed after another claimed the analysis leaves the row alone", async () => {
    const row: Row = { id: "an-1", run_id: "run-A", status: "parsing", stage: "fetch", stage_message: "Starting", error: null };
    const outcome = await withGitHub(
      () => {
        // A went stale mid-download; B claims the analysis; then A's download fails.
        Object.assign(row, claimedByB);
        return new Response(null, { status: 502, statusText: "Bad Gateway" });
      },
      () => runClaimed(claimA, { db: fakeDb(row) }),
    );
    assert.deepEqual(outcome, { status: "superseded" });
    assert.deepEqual(row, { id: "an-1", ...claimedByB });
  });

  test("a superseded run stops at its next stage write", async () => {
    const row: Row = { id: "an-1", run_id: "run-A", status: "parsing", stage: "fetch", stage_message: "Starting", error: null };
    const stages: string[] = [];
    const outcome = await withGitHub(
      () => {
        Object.assign(row, claimedByB);
        return new Response("not reached: the select stage never starts");
      },
      () => runClaimed(claimA, { db: fakeDb(row), onStage: (stage) => stages.push(stage) }),
    );
    assert.deepEqual(outcome, { status: "superseded" });
    assert.deepEqual(row, { id: "an-1", ...claimedByB });
    assert.deepEqual(stages, ["fetch", "fetch"]);
  });

  test("a run that still holds the analysis records its failure", async () => {
    const row: Row = { id: "an-1", run_id: "run-A", status: "parsing", stage: "fetch", stage_message: "Starting", error: null };
    const outcome = await withGitHub(
      () => new Response(null, { status: 502, statusText: "Bad Gateway" }),
      () => runClaimed(claimA, { db: fakeDb(row) }),
    );
    assert.equal(outcome.status, "failed");
    assert.equal(row.status, "failed");
    assert.equal(row.run_id, "run-A");
    assert.match(String(row.error), /GitHub answered 502/);
  });
});
