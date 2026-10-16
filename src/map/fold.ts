// Folding: which directories are nodes on the map.
//
// Every directory starts as its own node. Working from the deepest depth up,
// any directory holding fewer than `threshold` files merges into its parent,
// taking its files with it. If that leaves more nodes than anyone can read,
// the threshold goes up by one and the fold runs again from scratch. The
// repository's own shape decides how deep the map goes.

import type { FileNode } from "@/parser/types";

/** Roughly how many folded nodes a person can read at once. */
export const MAX_READABLE_NODES = 24;

/** The smallest threshold: a directory with a single file merges upward. */
export const MIN_THRESHOLD = 2;

export interface FolderGroup {
  /** The directory this node stands for; "." is the repository root. */
  dir: string;
  /** Every file the node holds, its own and those merged up into it, sorted. */
  files: string[];
}

export interface Fold {
  threshold: number;
  /** Sorted by `dir`. */
  groups: FolderGroup[];
  /** File path → the `dir` of the group holding it. */
  groupOf: Map<string, string>;
}

export function parentDir(dir: string): string | null {
  if (dir === ".") return null;
  const slash = dir.lastIndexOf("/");
  return slash < 0 ? "." : dir.slice(0, slash);
}

export function dirDepth(dir: string): number {
  return dir === "." ? 0 : dir.split("/").length;
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** One fold at a fixed threshold. */
export function foldAt(files: readonly Pick<FileNode, "path" | "folder">[], threshold: number): Fold {
  // Every directory on the way down to a file is a candidate, including ones
  // that hold no files directly.
  const held = new Map<string, string[]>();
  for (const file of files) {
    for (let dir: string | null = file.folder; dir !== null && !held.has(dir); dir = parentDir(dir)) {
      held.set(dir, []);
    }
    held.get(file.folder)!.push(file.path);
  }

  const byDepth = new Map<number, string[]>();
  for (const dir of held.keys()) {
    const d = dirDepth(dir);
    byDepth.set(d, [...(byDepth.get(d) ?? []), dir]);
  }

  // Deepest first. At each depth every decision is made before any merge is
  // applied, so no merge at a depth changes what another at that depth sees.
  // Merges only ever feed the depth above, which is decided on the next pass.
  const depths = [...byDepth.keys()].sort((a, b) => b - a);
  for (const depth of depths) {
    if (depth === 0) continue; // the root has nowhere to merge into
    const merging = byDepth.get(depth)!.filter((dir) => held.get(dir)!.length < threshold).sort(byPath);
    for (const dir of merging) {
      held.get(parentDir(dir)!)!.push(...held.get(dir)!);
      held.delete(dir);
    }
  }

  const groups: FolderGroup[] = [...held]
    .filter(([, held]) => held.length > 0)
    .map(([dir, held]) => ({ dir, files: [...held].sort(byPath) }))
    .sort((a, b) => byPath(a.dir, b.dir));

  const groupOf = new Map<string, string>();
  for (const group of groups) for (const file of group.files) groupOf.set(file, group.dir);
  return { threshold, groups, groupOf };
}

/** The fold at the lowest threshold that leaves at most `maxNodes` nodes. */
export function fold(files: readonly Pick<FileNode, "path" | "folder">[], maxNodes = MAX_READABLE_NODES): Fold {
  // Past files.length every directory merges, leaving the root alone, so this ends.
  for (let threshold = MIN_THRESHOLD; ; threshold++) {
    const result = foldAt(files, threshold);
    if (result.groups.length <= maxNodes || threshold > files.length) return result;
  }
}
