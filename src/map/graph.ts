// Graph maths over the parser's edge list: how far a change travels, what a
// file needs, and the four insights. Every answer is a walk over edges the
// parser produced, computed in the browser. Nothing here is a guess, and no
// model is involved.

import type { Conventions, DetailFile } from "./detail";
import type { MapEdge } from "./view";

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Adjacency both ways, built once per edge list. */
export interface GraphIndex {
  /** File → files it imports. */
  out: ReadonlyMap<string, readonly string[]>;
  /** File → files that import it. */
  into: ReadonlyMap<string, readonly string[]>;
}

export function graphIndex(edges: readonly MapEdge[]): GraphIndex {
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  const add = (index: Map<string, string[]>, key: string, value: string) => {
    const list = index.get(key);
    if (list) list.push(value);
    else index.set(key, [value]);
  };
  for (const edge of edges) {
    add(out, edge.source, edge.target);
    add(into, edge.target, edge.source);
  }
  for (const list of [...out.values(), ...into.values()]) list.sort(byPath);
  return { out, into };
}

/**
 * Which way a walk follows edges. Dependents are the blast radius: files that
 * import this one, and files that import those. Dependencies are the
 * dependency chain: what this file imports, and what that imports.
 */
export type Direction = "dependents" | "dependencies";

/**
 * Two levels by default. Any deeper and the walk returns most of a real
 * repository, which stops being an answer.
 */
export const REACH_DEPTH = 2;

export interface Reached {
  path: string;
  /** Steps from the start: 1 is a direct neighbour. */
  depth: number;
}

/**
 * Every file within `maxDepth` steps of `start` in one direction, nearest
 * first, then by path. Each file appears once, at the shortest distance it
 * was found. The start itself is never listed, even when a cycle leads back.
 */
export function reach(index: GraphIndex, start: string, direction: Direction, maxDepth = REACH_DEPTH): Reached[] {
  const next = direction === "dependents" ? index.into : index.out;
  const seen = new Set([start]);
  const found: Reached[] = [];
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const level: string[] = [];
    for (const file of frontier) {
      for (const neighbour of next.get(file) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        level.push(neighbour);
      }
    }
    level.sort(byPath);
    for (const path of level) found.push({ path, depth });
    frontier = level;
  }
  return found;
}

/**
 * Import cycles: strongly connected components with more than one file, plus
 * any file that imports itself. Tarjan's algorithm, run with an explicit
 * stack, because a real repository is deep enough to overflow the call stack.
 * Each cycle's files are sorted; cycles come largest first, then by first path.
 */
export function importCycles(files: readonly string[], index: GraphIndex): string[][] {
  const order = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;

  for (const root of [...files].sort(byPath)) {
    if (order.has(root)) continue;
    // Each frame is a file and how many of its imports have been visited.
    const work: { file: string; next: number }[] = [{ file: root, next: 0 }];
    order.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const targets = index.out.get(frame.file) ?? [];
      if (frame.next < targets.length) {
        const target = targets[frame.next++];
        if (!order.has(target)) {
          order.set(target, counter);
          low.set(target, counter++);
          stack.push(target);
          onStack.add(target);
          work.push({ file: target, next: 0 });
        } else if (onStack.has(target)) {
          low.set(frame.file, Math.min(low.get(frame.file)!, order.get(target)!));
        }
        continue;
      }

      // Every import visited: close the component if this file roots one,
      // then hand its low-link back to the file that reached it.
      work.pop();
      if (low.get(frame.file) === order.get(frame.file)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.file);
        if (component.length > 1 || targets.includes(frame.file)) cycles.push(component.sort(byPath));
      }
      const parent = work[work.length - 1];
      if (parent) low.set(parent.file, Math.min(low.get(parent.file)!, low.get(frame.file)!));
    }
  }
  return cycles.sort((a, b) => b.length - a.length || byPath(a[0], b[0]));
}

// Insights. Four kinds, each a fact about the edge list (or, for length, a
// count the parser recorded). Each kind has one fixed sentence; nothing
// writes or rewrites it.

export type InsightKind = "unimported" | "hub" | "cycle" | "oversized";

/** A file is too long past this many lines. */
export const OVERSIZED_LINES = 1000;
/** A file is imported by an unusual number of others at this share of the repository... */
export const HUB_SHARE = 0.05;
/** ...and never at fewer than this many, so a small repository doesn't call everything a hub. */
export const HUB_MIN_FAN_IN = 5;

export const INSIGHT_SENTENCES: Record<InsightKind, string> = {
  unimported: "Nothing in the repository imports these files, and no convention says what reaches them.",
  hub: "An unusual number of files import these.",
  cycle: "These files import each other in a loop.",
  oversized: `These files are over ${OVERSIZED_LINES.toLocaleString("en")} lines long.`,
};

/** The order insights are listed in: the explanatory one first, verdicts underneath. */
export const INSIGHT_ORDER: readonly InsightKind[] = ["unimported", "hub", "cycle", "oversized"];

/**
 * Files a framework or toolchain reaches by name rather than by import:
 * Next.js-style pages, layouts, route handlers, middleware and
 * instrumentation. The fallback adapter records no routes, so without these
 * names a Next.js app would have every page reported as unimported. A file
 * that matches is left out of that insight; it is never given a role.
 */
const FRAMEWORK_FILE = [
  /(^|\/)app\/(.+\/)?(page|layout|template|loading|error|global-error|not-found|default|route|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.[cm]?[jt]sx?$/,
  /(^|\/)pages\/.+\.[cm]?[jt]sx?$/,
  /^(src\/)?(middleware|proxy|instrumentation|instrumentation-client)\.[cm]?[jt]s$/,
];

export function reachedByFramework(path: string): boolean {
  return FRAMEWORK_FILE.some((pattern) => pattern.test(path));
}

export interface Insights {
  /** Files nothing imports that nothing else is known to reach: most imports first. */
  unimported: DetailFile[];
  /** Files imported by at least `hubThreshold` others: most imported first. */
  hubs: DetailFile[];
  hubThreshold: number;
  /** Each cycle's files, sorted; largest cycle first. */
  cycles: string[][];
  /** Files over OVERSIZED_LINES lines: longest first. */
  oversized: DetailFile[];
}

export function insights(files: readonly DetailFile[], index: GraphIndex, known: Conventions): Insights {
  const hubThreshold = Math.max(HUB_MIN_FAN_IN, Math.ceil(files.length * HUB_SHARE));
  return {
    // Routes, entry points, tests and config are reached by the framework, the
    // package manager or a test runner. The import graph can't see that, and
    // calling them unused would report the limit of the view as a finding.
    unimported: files
      .filter((f) => f.fanIn === 0 && known.of(f.path).length === 0 && !reachedByFramework(f.path))
      .sort((a, b) => b.fanOut - a.fanOut || byPath(a.path, b.path)),
    hubs: files.filter((f) => f.fanIn >= hubThreshold).sort((a, b) => b.fanIn - a.fanIn || byPath(a.path, b.path)),
    hubThreshold,
    cycles: importCycles(
      files.map((f) => f.path),
      index,
    ),
    oversized: files.filter((f) => f.lineCount > OVERSIZED_LINES).sort((a, b) => b.lineCount - a.lineCount || byPath(a.path, b.path)),
  };
}
