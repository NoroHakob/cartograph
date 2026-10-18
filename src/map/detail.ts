// What the detail pane says about the repository, a folder or a file. All of
// it is derived in the browser from parser output that is already loaded, so
// changing the selection never needs the network.

import type { FileNode, Language, Route } from "@/parser/types";
import type { Fold } from "./fold";
import { rowOrder, type MapEdge, type MapFile } from "./view";

export type DetailFile = MapFile &
  Pick<FileNode, "lineCount"> & {
    /** Set when no adapter identified the file and a model gave its role: the model's name. */
    roleBy?: string;
  };

/** The repository-level facts the parser recorded, beyond files and edges. */
export interface RepoFacts {
  name: string;
  /** The adapter the parser picked, e.g. "No framework". */
  framework: string;
  /** Import records the parser read, internal or not. */
  importCount: number;
  routes: Route[];
  /** Entry points that resolved to a node, with where each was declared. */
  entryPoints: { path: string; origin: string }[];
}

export const LANGUAGE_NAMES: Record<Language, string> = {
  ts: "TypeScript",
  tsx: "TypeScript with JSX",
  js: "JavaScript",
  jsx: "JavaScript with JSX",
  mjs: "JavaScript module",
  cjs: "CommonJS module",
  mts: "TypeScript module",
  cts: "TypeScript CommonJS module",
};

// Conventions: what a file is, from facts the parser recorded (routes, entry
// points) and from naming rules every JS toolchain follows. A file matching
// none of them is unidentified. Nothing here guesses from file contents.

export type ConventionId = "route" | "entry" | "test" | "config";

export interface Convention {
  id: ConventionId;
  label: string;
  /** Where the convention came from, e.g. "package.json#exports" or "GET /users". */
  detail?: string;
}

export const CONVENTION_LABELS: Record<ConventionId, string> = {
  route: "Route",
  entry: "Entry point",
  test: "Test",
  config: "Config",
};

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const TEST_DIR = /(^|\/)(__tests__|tests?)\//;
const CONFIG_FILE = /(^|\/)[^/]+\.config\.[cm]?[jt]s$/;

export interface Conventions {
  of(path: string): Convention[];
}

export function conventions(facts: Pick<RepoFacts, "routes" | "entryPoints">): Conventions {
  const routes = new Map<string, Route[]>();
  for (const route of facts.routes) routes.set(route.file, [...(routes.get(route.file) ?? []), route]);
  const entries = new Map<string, string[]>();
  for (const entry of facts.entryPoints) entries.set(entry.path, [...(entries.get(entry.path) ?? []), entry.origin]);

  return {
    of(path) {
      const found: Convention[] = [];
      for (const route of routes.get(path) ?? []) {
        const methods = route.methods.length > 0 ? `${route.methods.join(", ")} ` : "";
        found.push({ id: "route", label: CONVENTION_LABELS.route, detail: `${methods}${route.path}` });
      }
      const origins = entries.get(path);
      if (origins) found.push({ id: "entry", label: CONVENTION_LABELS.entry, detail: [...new Set(origins)].join(", ") });
      if (TEST_FILE.test(path) || TEST_DIR.test(path)) found.push({ id: "test", label: CONVENTION_LABELS.test });
      if (CONFIG_FILE.test(path)) found.push({ id: "config", label: CONVENTION_LABELS.config });
      return found;
    },
  };
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A file's neighbours, both ways, one entry per file. */
export interface Neighbours {
  /** Files this one imports. */
  imports: { path: string; typeOnly: boolean }[];
  /** Files that import this one. */
  importedBy: { path: string; typeOnly: boolean }[];
}

export function neighbourIndex(edges: readonly MapEdge[]): (path: string) => Neighbours {
  const out = new Map<string, Neighbours["imports"]>();
  const into = new Map<string, Neighbours["importedBy"]>();
  const add = (index: Map<string, Neighbours["imports"]>, key: string, path: string, typeOnly: boolean) => {
    const list = index.get(key);
    if (list) list.push({ path, typeOnly });
    else index.set(key, [{ path, typeOnly }]);
  };
  for (const edge of edges) {
    add(out, edge.source, edge.target, edge.typeOnly);
    add(into, edge.target, edge.source, edge.typeOnly);
  }
  const sorted = (list: Neighbours["imports"] | undefined) => [...(list ?? [])].sort((a, b) => byPath(a.path, b.path));
  return (path) => ({ imports: sorted(out.get(path)), importedBy: sorted(into.get(path)) });
}

export interface RepoSummary {
  fileCount: number;
  edgeCount: number;
  /** Files something imports, most imported first. */
  mostDependedOn: DetailFile[];
  /**
   * Files nothing imports: where reading starts. Entry points and routes
   * first, then other files, then tests; within each, the files that pull in
   * the most come first.
   */
  startHere: DetailFile[];
  /** Files no convention identifies. */
  unidentified: number;
}

export function repoSummary(files: readonly DetailFile[], edges: readonly MapEdge[], known: Conventions): RepoSummary {
  const rank = (file: DetailFile) => {
    const ids = known.of(file.path).map((c) => c.id);
    return ids.includes("entry") || ids.includes("route") ? 0 : ids.includes("test") ? 2 : 1;
  };
  return {
    fileCount: files.length,
    edgeCount: edges.length,
    mostDependedOn: files.filter((f) => f.fanIn > 0).sort(rowOrder),
    startHere: files
      .filter((f) => f.fanIn === 0)
      .map((f) => ({ file: f, rank: rank(f) }))
      .sort((a, b) => a.rank - b.rank || b.file.fanOut - a.file.fanOut || byPath(a.file.path, b.file.path))
      .map(({ file }) => file),
    unidentified: files.filter((f) => known.of(f.path).length === 0).length,
  };
}

export interface FolderSummary {
  dir: string;
  /** The folder's files, most depended-on first. */
  files: DetailFile[];
  /** File count per extension, largest first. */
  languages: { language: Language; count: number }[];
  /** File count per convention, in CONVENTION_LABELS order; a file can count under several. */
  conventions: { id: ConventionId; count: number }[];
  /** Files in the folder no convention identifies. */
  unidentified: number;
}

export function folderSummary(fold: Fold, dir: string, fileByPath: ReadonlyMap<string, DetailFile>, known: Conventions): FolderSummary | null {
  const group = fold.groups.find((g) => g.dir === dir);
  if (!group) return null;
  const files = group.files.map((p) => fileByPath.get(p)!).sort(rowOrder);

  const languages = new Map<Language, number>();
  const counts = new Map<ConventionId, number>();
  let unidentified = 0;
  for (const file of files) {
    languages.set(file.language, (languages.get(file.language) ?? 0) + 1);
    const ids = new Set(known.of(file.path).map((c) => c.id));
    if (ids.size === 0) unidentified++;
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return {
    dir,
    files,
    languages: [...languages]
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count || byPath(a.language, b.language)),
    conventions: (Object.keys(CONVENTION_LABELS) as ConventionId[]).filter((id) => counts.has(id)).map((id) => ({ id, count: counts.get(id)! })),
    unidentified,
  };
}
