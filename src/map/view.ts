// What is on screen for a given fold and set of open folders. Everything here
// is derived from the parser's files and edges; nothing is added or renamed.

import type { Edge, FileNode, Language, RoleId } from "@/parser/types";
import type { Fold } from "./fold";

/**
 * Rows an open panel shows at once. Longer folders scroll inside the panel,
 * which stays this tall and says how many rows are above and below.
 */
export const PANEL_ROW_LIMIT = 12;

export type MapFile = Pick<FileNode, "path" | "folder" | "language" | "role" | "fanIn" | "fanOut">;
export type MapEdge = Pick<Edge, "source" | "target" | "typeOnly">;

export interface GroupStats {
  dir: string;
  fileCount: number;
  /** Distinct files outside the group that import something inside it. */
  fanIn: number;
  /** Distinct files outside the group that something inside it imports. */
  fanOut: number;
  /** File count per extension, largest first. */
  languages: { language: Language; count: number }[];
  /** File count per role, largest first. */
  roles: { role: RoleId; count: number }[];
}

export interface ViewRow {
  path: string;
  label: string;
  language: Language;
  role: RoleId;
  fanIn: number;
  fanOut: number;
}

export interface ViewNode {
  id: string;
  dir: string;
  label: string;
  open: boolean;
  stats: GroupStats;
  /** Open panels only: every file as a row, most depended-on first. */
  rows: ViewRow[];
  /** Open panels only: index of the first row in the scrolled window. */
  windowStart: number;
  /** Open panels only: rows scrolled out of view above and below the window. */
  hiddenAbove: number;
  hiddenBelow: number;
}

export interface ViewEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  /** How many parser edges this line stands for. */
  count: number;
  /** True only when every parser edge behind it is type-only. */
  typeOnly: boolean;
  /** The files at each end of the parser edges behind it, sorted. */
  sourceFiles: string[];
  targetFiles: string[];
}

export interface MapView {
  nodes: ViewNode[];
  edges: ViewEdge[];
}

export const nodeId = (dir: string) => `dir:${dir}`;

// Handle ids. A folded node has one of each. An open panel has one pair per
// row in its scrolled window, a pair on its header for rows scrolled above
// the window, and a pair on its footer for rows below it.
export const FOLDED_IN = "in";
export const FOLDED_OUT = "out";
export const ABOVE_IN = "above-in";
export const ABOVE_OUT = "above-out";
export const BELOW_IN = "below-in";
export const BELOW_OUT = "below-out";
export const rowIn = (path: string) => `row-in:${path}`;
export const rowOut = (path: string) => `row-out:${path}`;

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function groupStats(fold: Fold, files: readonly MapFile[], edges: readonly MapEdge[]): Map<string, GroupStats> {
  const fanIn = new Map<string, Set<string>>();
  const fanOut = new Map<string, Set<string>>();
  for (const edge of edges) {
    const from = fold.groupOf.get(edge.source)!;
    const to = fold.groupOf.get(edge.target)!;
    if (from === to) continue;
    fanIn.set(to, (fanIn.get(to) ?? new Set()).add(edge.source));
    fanOut.set(from, (fanOut.get(from) ?? new Set()).add(edge.target));
  }

  const fileByPath = new Map(files.map((f) => [f.path, f]));
  const stats = new Map<string, GroupStats>();
  for (const group of fold.groups) {
    const counts = new Map<Language, number>();
    const roles = new Map<RoleId, number>();
    for (const path of group.files) {
      const file = fileByPath.get(path)!;
      counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
      roles.set(file.role, (roles.get(file.role) ?? 0) + 1);
    }
    stats.set(group.dir, {
      dir: group.dir,
      fileCount: group.files.length,
      fanIn: fanIn.get(group.dir)?.size ?? 0,
      fanOut: fanOut.get(group.dir)?.size ?? 0,
      languages: [...counts]
        .map(([language, count]) => ({ language, count }))
        .sort((a, b) => b.count - a.count || byPath(a.language, b.language)),
      roles: [...roles]
        .map(([role, count]) => ({ role, count }))
        .sort((a, b) => b.count - a.count || byPath(a.role, b.role)),
    });
  }
  return stats;
}

/**
 * The shortest trailing run of path segments that no other path in the set
 * shares. Paths that would still collide at full length keep their full path.
 */
export function shortestUniqueLabels(paths: readonly string[]): Map<string, string> {
  const segments = new Map(paths.map((p) => [p, p.split("/")]));
  const take = new Map(paths.map((p) => [p, 1]));
  const label = (p: string) => segments.get(p)!.slice(-take.get(p)!).join("/");

  for (;;) {
    const holders = new Map<string, string[]>();
    for (const p of paths) holders.set(label(p), [...(holders.get(label(p)) ?? []), p]);
    let grew = false;
    for (const clash of holders.values()) {
      if (clash.length < 2) continue;
      for (const p of clash) {
        if (take.get(p)! < segments.get(p)!.length) {
          take.set(p, take.get(p)! + 1);
          grew = true;
        }
      }
    }
    if (!grew) break;
  }
  return new Map(paths.map((p) => [p, label(p)]));
}

/** Rows in the order a panel lists them: most depended-on first, then by path. */
export function rowOrder(a: MapFile, b: MapFile) {
  return b.fanIn - a.fanIn || byPath(a.path, b.path);
}

export function computeView(
  fold: Fold,
  stats: ReadonlyMap<string, GroupStats>,
  files: readonly MapFile[],
  edges: readonly MapEdge[],
  open: ReadonlySet<string>,
  rootName: string,
  /** First row of each open panel's scrolled window, by dir. Missing means 0. */
  scroll: ReadonlyMap<string, number> = new Map(),
): MapView {
  const fileByPath = new Map(files.map((f) => [f.path, f]));

  // Every file of an open panel is a row; the scrolled window decides which
  // rows edges attach to directly.
  const panelRows = new Map<string, MapFile[]>();
  const windowStart = new Map<string, number>();
  const rowIndex = new Map<string, number>();
  for (const group of fold.groups) {
    if (!open.has(group.dir)) continue;
    const sorted = group.files.map((p) => fileByPath.get(p)!).sort(rowOrder);
    panelRows.set(group.dir, sorted);
    const last = Math.max(0, sorted.length - PANEL_ROW_LIMIT);
    windowStart.set(group.dir, Math.min(last, Math.max(0, Math.floor(scroll.get(group.dir) ?? 0))));
    sorted.forEach((f, i) => rowIndex.set(f.path, i));
  }

  // Labels are unique across folder nodes and every row of every open panel.
  // Rows count whether or not they're scrolled into view, so scrolling never
  // relabels anything or changes a panel's width. The root has no path
  // segments to show, so it takes the repository's name.
  const rowPaths = [...panelRows.values()].flat().map((f) => f.path);
  const labels = shortestUniqueLabels([...fold.groups.filter((g) => g.dir !== ".").map((g) => g.dir), ...rowPaths]);

  const nodes: ViewNode[] = fold.groups.map((group) => {
    const rows = panelRows.get(group.dir) ?? [];
    const start = windowStart.get(group.dir) ?? 0;
    return {
      id: nodeId(group.dir),
      dir: group.dir,
      label: group.dir === "." ? rootName : labels.get(group.dir)!,
      open: open.has(group.dir),
      stats: stats.get(group.dir)!,
      rows: rows.map((f) => ({ path: f.path, label: labels.get(f.path)!, language: f.language, role: f.role, fanIn: f.fanIn, fanOut: f.fanOut })),
      windowStart: start,
      hiddenAbove: start,
      hiddenBelow: Math.max(0, rows.length - start - PANEL_ROW_LIMIT),
    };
  });

  const end = (file: string, side: "in" | "out") => {
    const dir = fold.groupOf.get(file)!;
    const node = nodeId(dir);
    if (!open.has(dir)) return { node, handle: side === "in" ? FOLDED_IN : FOLDED_OUT };
    const offset = rowIndex.get(file)! - windowStart.get(dir)!;
    if (offset < 0) return { node, handle: side === "in" ? ABOVE_IN : ABOVE_OUT };
    if (offset >= PANEL_ROW_LIMIT) return { node, handle: side === "in" ? BELOW_IN : BELOW_OUT };
    return { node, handle: side === "in" ? rowIn(file) : rowOut(file) };
  };

  const merged = new Map<string, ViewEdge & { sources: Set<string>; targets: Set<string> }>();
  for (const edge of edges) {
    const from = end(edge.source, "out");
    const to = end(edge.target, "in");
    // Imports inside one node or one panel aren't drawn: the line would leave
    // the box only to come straight back.
    if (from.node === to.node) continue;
    const id = `${from.node}|${from.handle}->${to.node}|${to.handle}`;
    const existing = merged.get(id);
    if (existing) {
      existing.count++;
      existing.typeOnly &&= edge.typeOnly;
      existing.sources.add(edge.source);
      existing.targets.add(edge.target);
    } else {
      merged.set(id, {
        id,
        source: from.node,
        target: to.node,
        sourceHandle: from.handle,
        targetHandle: to.handle,
        count: 1,
        typeOnly: edge.typeOnly,
        sourceFiles: [],
        targetFiles: [],
        sources: new Set([edge.source]),
        targets: new Set([edge.target]),
      });
    }
  }

  const viewEdges = [...merged.values()].map(({ sources, targets, ...edge }) => ({
    ...edge,
    sourceFiles: [...sources].sort(byPath),
    targetFiles: [...targets].sort(byPath),
  }));
  return { nodes, edges: viewEdges.sort((a, b) => byPath(a.id, b.id)) };
}
