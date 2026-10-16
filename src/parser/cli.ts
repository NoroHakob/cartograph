// Usage: pnpm parse <dir> [--out result.json] [--examples N] [--check]
//
// Parses a directory, prints what it found, and optionally writes the full
// result as JSON (the shape in ./types.ts). --check exits non-zero if the
// result breaks any invariant.

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { parseRepository } from "./index";
import { checkInvariants, writeParseResult } from "./output";
import type { CoverageBucket, ParseResult } from "./types";

function main(argv: string[]): number {
  let dir: string | undefined;
  let out: string | undefined;
  let examples = 3;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") out = argv[++i];
    else if (arg === "--examples") examples = Number(argv[++i]);
    else if (arg === "--check") check = true;
    else if (arg === "--help" || arg === "-h") return usage(0);
    else if (arg.startsWith("--")) return usage(1, `unknown flag ${arg}`);
    else if (dir === undefined) dir = arg;
    else return usage(1, `unexpected argument ${arg}`);
  }
  if (!dir) return usage(1, "missing directory");
  if (out === undefined && argv.includes("--out")) return usage(1, "--out needs a file path");
  if (!Number.isInteger(examples) || examples < 0) return usage(1, "--examples needs a whole number");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return usage(1, `not a directory: ${dir}`);

  const result = parseRepository(dir, { examplesPerBucket: Math.max(examples, 10) });
  print(result, examples);

  const problems = checkInvariants(result);
  if (problems.length > 0) {
    console.log(`\ninvariants  ${problems.length} broken`);
    for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
  } else {
    console.log("\ninvariants  all hold");
  }

  if (out) {
    writeParseResult(result, out);
    console.log(`wrote       ${path.resolve(out)}`);
  }
  return check && problems.length > 0 ? 1 : 0;
}

function print(r: ParseResult, examples: number) {
  const c = r.coverage;
  const pct = (n: number) => (c.total === 0 ? "0.0" : ((n / c.total) * 100).toFixed(1)).padStart(5) + "%";
  const row = (label: string, value: string | number) => console.log(`${label.padEnd(12)}${value}`);
  const bucketLines = (buckets: Partial<Record<string, CoverageBucket>>, showExamples: boolean) => {
    const entries = Object.entries(buckets).filter((e): e is [string, CoverageBucket] => e[1] !== undefined);
    for (const [key, bucket] of entries.sort((a, b) => b[1].count - a[1].count)) {
      console.log(`              ${key.padEnd(28)}${String(bucket.count).padStart(6)}`);
      if (!showExamples) continue;
      for (const ex of bucket.examples.slice(0, examples)) {
        console.log(`                ${ex.source}:${ex.line}  ${JSON.stringify(ex.specifier)}${ex.detail ? `  (${ex.detail})` : ""}`);
      }
    }
  };

  console.log(`Cartograph parser: ${r.root}\n`);
  row("adapter", `${r.adapter.name} (${r.adapter.id})`);
  row("modules", r.modules.length);
  for (const m of r.modules.slice(0, 10)) console.log(`              ${m.dir.padEnd(28)}${String(m.fileCount).padStart(6)}  ${m.name}`);
  if (r.modules.length > 10) console.log(`              ... ${r.modules.length - 10} more`);
  const lines = r.files.reduce((n, f) => n + f.lineCount, 0);
  row("files", `${r.files.length} nodes, ${lines} lines`);
  if (r.excludedFiles.length > 0) {
    const reasons = new Map<string, number>();
    for (const f of r.excludedFiles) reasons.set(f.reason, (reasons.get(f.reason) ?? 0) + 1);
    row("", `${r.excludedFiles.length} excluded: ${[...reasons].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }

  console.log("");
  row("imports", `${c.total} seen`);
  console.log(`  internal  ${String(c.internal).padStart(16)} ${pct(c.internal)}`);
  console.log(`  external  ${String(c.external).padStart(16)} ${pct(c.external)}`);
  bucketLines(c.externalByKind, false);
  console.log(`  excluded  ${String(c.excluded).padStart(16)} ${pct(c.excluded)}`);
  bucketLines(c.excludedByReason, true);
  console.log(`  unresolved${String(c.unresolved).padStart(16)} ${pct(c.unresolved)}`);
  bucketLines(c.unresolvedByReason, true);

  console.log("");
  row("edges", `${r.edges.length} (${r.stats.duplicateImportsCollapsed} duplicate imports collapsed)`);
  const top = (key: "fanIn" | "fanOut") =>
    [...r.files].sort((a, b) => b[key] - a[key] || (a.path < b.path ? -1 : 1)).filter((f) => f[key] > 0).slice(0, 5);
  row("top fan-in", "");
  for (const f of top("fanIn")) console.log(`  ${String(f.fanIn).padStart(4)}  ${f.path}`);
  row("top fan-out", "");
  for (const f of top("fanOut")) console.log(`  ${String(f.fanOut).padStart(4)}  ${f.path}`);

  if (r.entryPoints.length > 0) {
    console.log("");
    row("entries", r.entryPoints.length);
    for (const e of r.entryPoints.slice(0, 10)) console.log(`  ${e.origin}  ${e.declared} -> ${e.path ?? "(no such node)"}`);
  }
  if (r.configNotes.length > 0) {
    console.log("");
    row("config", `${r.configNotes.length} note(s)`);
    for (const n of r.configNotes.slice(0, 5)) console.log(`  ${n.config}: ${n.message.split("\n")[0]}`);
  }
  console.log("");
  row("took", `${r.stats.durationMs} ms`);
}

function usage(code: number, error?: string): number {
  if (error) console.error(`error: ${error}\n`);
  console.error("usage: pnpm parse <dir> [--out result.json] [--examples N] [--check]");
  return code;
}

process.exitCode = main(process.argv.slice(2));
