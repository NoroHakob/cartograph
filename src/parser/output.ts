import { readFileSync, writeFileSync } from "node:fs";
import { PARSE_RESULT_VERSION, type ParseResult } from "./types";

/**
 * Checks the promises the result makes to everything downstream. Returns
 * every broken one; an empty list means the result is sound.
 */
export function checkInvariants(result: ParseResult): string[] {
  const problems: string[] = [];
  const nodes = new Set(result.files.map((f) => f.path));
  if (nodes.size !== result.files.length) problems.push("duplicate file paths");

  const pairs = new Set<string>();
  for (const edge of result.edges) {
    if (!nodes.has(edge.source)) problems.push(`edge source is not a node: ${edge.source}`);
    if (!nodes.has(edge.target)) problems.push(`edge target is not a node: ${edge.target}`);
    const key = `${edge.source}\u0000${edge.target}`;
    if (pairs.has(key)) problems.push(`duplicate edge: ${edge.source} -> ${edge.target}`);
    pairs.add(key);
  }

  let internal = 0;
  for (const record of result.imports) {
    if (!nodes.has(record.source)) problems.push(`import source is not a node: ${record.source}`);
    const r = record.resolution;
    if (r.status === "internal") {
      internal++;
      if (!nodes.has(r.target)) problems.push(`internal import target is not a node: ${r.target}`);
      if (!pairs.has(`${record.source}\u0000${r.target}`)) problems.push(`internal import has no edge: ${record.source} -> ${r.target}`);
    }
    if (r.status === "excluded" && nodes.has(r.target)) problems.push(`excluded import targets a node: ${r.target}`);
  }

  const occurrences = result.edges.reduce((n, e) => n + e.occurrences, 0);
  if (occurrences !== internal) problems.push(`edges account for ${occurrences} imports, ${internal} are internal`);

  const c = result.coverage;
  if (c.internal + c.external + c.excluded + c.unresolved !== c.total) problems.push("coverage buckets don't sum to total");
  if (c.total !== result.imports.length) problems.push("coverage total doesn't match imports");

  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const e of result.edges) {
    fanIn.set(e.target, (fanIn.get(e.target) ?? 0) + 1);
    fanOut.set(e.source, (fanOut.get(e.source) ?? 0) + 1);
  }
  for (const f of result.files) {
    if (f.fanIn !== (fanIn.get(f.path) ?? 0)) problems.push(`fan-in mismatch: ${f.path}`);
    if (f.fanOut !== (fanOut.get(f.path) ?? 0)) problems.push(`fan-out mismatch: ${f.path}`);
  }
  return problems;
}

export function writeParseResult(result: ParseResult, file: string): void {
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
}

/** Reads a result written by `writeParseResult`, refusing other versions or broken data. */
export function readParseResult(file: string): ParseResult {
  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!data || typeof data !== "object" || (data as { version?: unknown }).version !== PARSE_RESULT_VERSION) {
    throw new Error(`${file} is not a version ${PARSE_RESULT_VERSION} parse result`);
  }
  // The version matches, so the shape is the one this code wrote. The
  // invariant check below catches files that were edited into nonsense.
  const result = data as ParseResult;
  const problems = checkInvariants(result);
  if (problems.length > 0) throw new Error(`${file} fails ${problems.length} invariant(s): ${problems[0]}`);
  return result;
}
