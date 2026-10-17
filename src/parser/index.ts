import { statSync } from "node:fs";
import path from "node:path";
import { selectAdapter, type Adapter, type RepoContext } from "./adapters/index.ts";
import { createImportReader } from "./imports.ts";
import { createResolver } from "./resolve.ts";
import { loadConfigs } from "./tsconfig.ts";
import {
  PARSE_RESULT_VERSION,
  type Coverage,
  type CoverageBucket,
  type Edge,
  type FileNode,
  type ImportExample,
  type ImportKind,
  type ImportRecord,
  type ParseResult,
} from "./types.ts";
import { assignModules, walkRepository } from "./walk.ts";

export type * from "./types.ts";
export { PARSE_RESULT_VERSION } from "./types.ts";
export type { Adapter, RepoContext } from "./adapters/index.ts";

export interface ParseOptions {
  /** Examples kept per coverage bucket. Every import is still in `imports`. */
  examplesPerBucket?: number;
  /** Override the adapter list; the no-framework fallback is used if none match. */
  adapters?: readonly Adapter[];
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** Parses the repository at `dir`. Reads the disk; touches nothing else. */
export function parseRepository(dir: string, options: ParseOptions = {}): ParseResult {
  const started = performance.now();
  const root = path.resolve(dir);
  if (!statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`);

  const walked = walkRepository(root);
  const { moduleOf, modules } = assignModules(path.basename(root), walked.files, walked.packageJsons);
  const nodes = new Set(walked.files.map((f) => f.path));
  const configs = loadConfigs(root, walked.configFiles);
  const resolve = createResolver({
    root,
    nodes,
    excludedFiles: new Map(walked.excludedFiles.map((f) => [f.path, f.reason])),
    packageJsons: walked.packageJsons,
    isIgnored: walked.isIgnored,
    configs,
  });

  const readImports = createImportReader();
  const imports: ImportRecord[] = [];
  for (const file of walked.files) {
    for (const raw of readImports(file.path, file.language, file.text).sort((a, b) => a.line - b.line)) {
      imports.push({
        source: file.path,
        specifier: raw.specifier,
        kind: raw.kind,
        typeOnly: raw.typeOnly,
        line: raw.line,
        resolution: raw.literal
          ? resolve(file.path, raw.specifier, raw.kind)
          : { status: "unresolved", reason: "non-literal-specifier" },
      });
    }
  }

  const { edges, collapsed } = buildEdges(imports);
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const edge of edges) {
    fanOut.set(edge.source, (fanOut.get(edge.source) ?? 0) + 1);
    fanIn.set(edge.target, (fanIn.get(edge.target) ?? 0) + 1);
  }

  const files: FileNode[] = walked.files.map((f) => ({
    path: f.path,
    folder: f.folder,
    language: f.language,
    lineCount: f.lineCount,
    hash: f.hash,
    module: moduleOf.get(f.path) ?? ".",
    fanIn: fanIn.get(f.path) ?? 0,
    fanOut: fanOut.get(f.path) ?? 0,
  }));

  const repo: RepoContext = {
    root,
    files,
    edges,
    modules,
    packageJsons: walked.packageJsons,
    hasNode: (p) => nodes.has(p),
    findNode: (p) => {
      const candidates = [p, ...SOURCE_EXTENSIONS.map((e) => p + e), ...SOURCE_EXTENSIONS.map((e) => `${p}/index${e}`)];
      return candidates.find((c) => nodes.has(c)) ?? null;
    },
  };
  const adapter = selectAdapter(repo, options.adapters);

  return {
    version: PARSE_RESULT_VERSION,
    root,
    adapter: { id: adapter.id, name: adapter.name },
    modules,
    files,
    excludedFiles: walked.excludedFiles,
    imports,
    edges,
    coverage: summarise(imports, options.examplesPerBucket ?? 10),
    entryPoints: adapter.entryPoints(repo),
    routes: adapter.routes(repo),
    configNotes: configs.notes,
    stats: { durationMs: Math.round(performance.now() - started), duplicateImportsCollapsed: collapsed },
  };
}

/** One edge per (source, target) pair of internal imports. */
function buildEdges(imports: ImportRecord[]): { edges: Edge[]; collapsed: number } {
  const byPair = new Map<string, Edge & { kindSet: Set<ImportKind> }>();
  let internal = 0;
  for (const record of imports) {
    if (record.resolution.status !== "internal") continue;
    internal++;
    const target = record.resolution.target;
    const key = `${record.source}\u0000${target}`;
    const existing = byPair.get(key);
    if (existing) {
      existing.kindSet.add(record.kind);
      existing.typeOnly &&= record.typeOnly;
      existing.occurrences++;
    } else {
      byPair.set(key, {
        source: record.source,
        target,
        kinds: [],
        kindSet: new Set([record.kind]),
        typeOnly: record.typeOnly,
        occurrences: 1,
      });
    }
  }
  const edges = [...byPair.values()]
    .map(({ kindSet, ...edge }) => ({ ...edge, kinds: [...kindSet].sort() }))
    .sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target));
  return { edges, collapsed: internal - edges.length };
}

function summarise(imports: ImportRecord[], limit: number): Coverage {
  const coverage: Coverage = {
    total: imports.length,
    internal: 0,
    external: 0,
    excluded: 0,
    unresolved: 0,
    classifiedRatio: 1,
    externalByKind: {},
    excludedByReason: {},
    unresolvedByReason: {},
  };

  const add = <K extends string>(buckets: Partial<Record<K, CoverageBucket>>, key: K, example: ImportExample) => {
    const bucket = (buckets[key] ??= { count: 0, examples: [] });
    bucket.count++;
    if (bucket.examples.length < limit) bucket.examples.push(example);
  };

  for (const record of imports) {
    const r = record.resolution;
    const example: ImportExample = { source: record.source, line: record.line, specifier: record.specifier };
    coverage[r.status]++;
    if (r.status === "external") add(coverage.externalByKind, r.kind, example);
    else if (r.status === "excluded") add(coverage.excludedByReason, r.reason, { ...example, detail: r.target });
    else if (r.status === "unresolved") add(coverage.unresolvedByReason, r.reason, r.detail ? { ...example, detail: r.detail } : example);
  }
  if (coverage.total > 0) coverage.classifiedRatio = (coverage.total - coverage.unresolved) / coverage.total;
  return coverage;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
