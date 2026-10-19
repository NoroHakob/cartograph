// The six lookups the agent can make, each a thin read over the functions
// that draw the canvas: graphIndex and reach for the walks, neighbourIndex for
// the pane's import lists, repoSummary and insights for the repository view.
// Nothing here computes a relationship of its own. The agent picks a file and
// a direction; the existing walk does the walking.
//
// Every answer is plain JSON, sized for a model's context: long lists are cut
// and say how many were left out. A path that isn't in the analysis is an
// error that lists real paths, never a guess at which one was meant.

import { conventions, neighbourIndex, repoSummary, type DetailFile, type RepoFacts } from "../map/detail";
import { graphIndex, insights, REACH_DEPTH, reach, type Direction } from "../map/graph";
import { rowOrder, type MapEdge } from "../map/view";
import { FRAMEWORKS, isRoleId, ROLES, type FrameworkId, type RoleId } from "../parser/taxonomy";

/** One analysis as the map has it. The explorer's loaded data satisfies it. */
export interface AskGraph {
  framework: FrameworkId;
  files: readonly DetailFile[];
  edges: readonly MapEdge[];
  facts: RepoFacts;
}

export const TOOL_NAMES = ["repo_summary", "find_files", "files_by_role", "neighbours", "walk", "routes"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && (TOOL_NAMES as readonly string[]).includes(value);
}

/** Longest list any answer returns before cutting. */
export const LIST_LIMIT = 40;
/** Deepest walk the agent may ask for. Past this a walk returns most of a repository. */
export const MAX_WALK_DEPTH = 4;

/** A tool's input was wrong: unknown tool, missing argument, or a path the analysis doesn't have. */
export class ToolInputError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type FileRow = { path: string; role: RoleId; fanIn: number; fanOut: number; lines: number };
const row = (f: DetailFile): FileRow => ({ path: f.path, role: f.role, fanIn: f.fanIn, fanOut: f.fanOut, lines: f.lineCount });

function cut<T>(items: readonly T[], limit = LIST_LIMIT): { items: T[]; omitted: number } {
  return { items: items.slice(0, limit), omitted: Math.max(0, items.length - limit) };
}

/** The tools over one analysis. Indexes are built once, on first use. */
export function askTools(graph: AskGraph) {
  const fileByPath = new Map(graph.files.map((f) => [f.path, f]));
  const known = conventions(graph.facts);
  let index: ReturnType<typeof graphIndex> | undefined;
  let neighbours: ReturnType<typeof neighbourIndex> | undefined;

  /**
   * The file at `path`, or an error naming real files: those whose path
   * contains all of `path`, else those containing its last segment.
   */
  function fileAt(path: string): DetailFile {
    const file = fileByPath.get(path);
    if (file) return file;
    const containing = (needle: string) => (needle ? graph.files.filter((f) => f.path.toLowerCase().includes(needle)).sort(rowOrder) : []);
    const whole = containing(path.toLowerCase().replace(/^\.?\/+/, ""));
    const similar = whole.length > 0 ? whole : containing(path.split("/").filter(Boolean).pop()?.toLowerCase() ?? "");
    throw new ToolInputError(`No file at "${path}" in this analysis. Paths are repository-relative, e.g. "src/index.ts".`, {
      similarPaths: similar.slice(0, 10).map((f) => f.path),
    });
  }

  return {
    /** The whole analysis in one look: size, framework, roles, routes, and the files that matter most. */
    repo_summary() {
      const summary = repoSummary(graph.files, graph.edges, known);
      index ??= graphIndex(graph.edges);
      const found = insights(graph.files, index, known);
      const roles = new Map<RoleId, number>();
      for (const f of graph.files) roles.set(f.role, (roles.get(f.role) ?? 0) + 1);
      return {
        repository: graph.facts.name,
        framework: graph.facts.framework,
        files: summary.fileCount,
        internalImportEdges: summary.edgeCount,
        importStatements: graph.facts.importCount,
        routes: graph.facts.routes.length,
        roles: [...roles].map(([role, count]) => ({ role, name: ROLES[role].name, count })).sort((a, b) => b.count - a.count),
        entryPoints: graph.facts.entryPoints,
        mostDependedOn: summary.mostDependedOn.slice(0, 10).map(row),
        startHere: summary.startHere.slice(0, 10).map(row),
        hubs: { threshold: found.hubThreshold, files: found.hubs.slice(0, 10).map((f) => f.path) },
        importCycles: { count: found.cycles.length, largest: found.cycles.slice(0, 3) },
        unimported: { count: found.unimported.length, files: found.unimported.slice(0, 10).map((f) => f.path) },
        oversized: found.oversized.slice(0, 10).map(row),
      };
    },

    /** Files whose repository-relative path contains `query`, ignoring case. Most depended-on first. */
    find_files({ query }: { query: string }) {
      const needle = query.trim().toLowerCase();
      if (!needle) throw new ToolInputError("query must name part of a path, e.g. \"auth\" or \"src/middleware\".");
      const matches = graph.files.filter((f) => f.path.toLowerCase().includes(needle)).sort(rowOrder);
      const { items, omitted } = cut(matches);
      return { query, total: matches.length, files: items.map(row), omitted };
    },

    /** Files the parser gave `role`. With an unknown role, the roles this analysis has instead. */
    files_by_role({ role }: { role: string }) {
      const present = [...new Set(graph.files.map((f) => f.role))];
      if (!isRoleId(role) || !present.includes(role)) {
        throw new ToolInputError(`No files have the role "${role}" in this analysis.`, {
          rolesPresent: present.map((r) => ({ role: r, name: ROLES[r].name })),
          frameworkRoles: FRAMEWORKS[graph.framework].roles,
        });
      }
      const matches = graph.files.filter((f) => f.role === role).sort(rowOrder);
      const { items, omitted } = cut(matches);
      return { role, name: ROLES[role].name, total: matches.length, files: items.map(row), omitted };
    },

    /** What one file imports and what imports it, directly. */
    neighbours({ path }: { path: string }) {
      const file = fileAt(path);
      neighbours ??= neighbourIndex(graph.edges);
      const { imports, importedBy } = neighbours(file.path);
      const a = cut(imports);
      const b = cut(importedBy);
      return {
        file: row(file),
        conventions: known.of(file.path),
        imports: a.items,
        importsOmitted: a.omitted,
        importedBy: b.items,
        importedByOmitted: b.omitted,
      };
    },

    /**
     * Every file within `depth` steps of `path`. "dependents" is the blast
     * radius (what breaks if this changes); "dependencies" is what this file
     * relies on.
     */
    walk({ path, direction, depth = REACH_DEPTH }: { path: string; direction: Direction; depth?: number }) {
      const file = fileAt(path);
      if (direction !== "dependents" && direction !== "dependencies") {
        throw new ToolInputError('direction must be "dependents" or "dependencies".');
      }
      if (!Number.isInteger(depth) || depth < 1 || depth > MAX_WALK_DEPTH) {
        throw new ToolInputError(`depth must be a whole number from 1 to ${MAX_WALK_DEPTH}.`);
      }
      index ??= graphIndex(graph.edges);
      const found = reach(index, file.path, direction, depth);
      const byDepth = Array.from({ length: depth }, (_, i) => found.filter((r) => r.depth === i + 1).length);
      const { items, omitted } = cut(found, 100);
      return { start: file.path, direction, depth, total: found.length, countByDepth: byDepth, files: items, omitted };
    },

    /** The route table the framework adapter recorded: one row per route, with its declaring file. */
    routes() {
      const { items, omitted } = cut(graph.facts.routes, 100);
      return {
        framework: graph.facts.framework,
        total: graph.facts.routes.length,
        routes: items.map(({ path, methods, kind, file, line }) => ({ path, methods, kind, file, line })),
        omitted,
      };
    },
  };
}

export type AskTools = ReturnType<typeof askTools>;

/**
 * Runs `name` with `input` as it arrived over the wire: checks every argument
 * before any lookup. Throws ToolInputError for anything malformed.
 */
export function runTool(tools: AskTools, name: string, input: unknown): unknown {
  if (!isToolName(name)) throw new ToolInputError(`Unknown tool "${name}".`, { tools: TOOL_NAMES });
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (key: string): string => {
    const value = args[key];
    if (typeof value !== "string" || !value.trim()) throw new ToolInputError(`${name} needs "${key}" as a non-empty string.`);
    return value.trim();
  };
  switch (name) {
    case "repo_summary":
      return tools.repo_summary();
    case "find_files":
      return tools.find_files({ query: text("query") });
    case "files_by_role":
      return tools.files_by_role({ role: text("role") });
    case "neighbours":
      return tools.neighbours({ path: text("path") });
    case "walk": {
      const depth = args.depth;
      if (depth !== undefined && typeof depth !== "number") throw new ToolInputError("walk's depth must be a number.");
      return tools.walk({ path: text("path"), direction: text("direction") as Direction, depth });
    }
    case "routes":
      return tools.routes();
  }
}
