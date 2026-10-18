// Categories of file: the roles the parser's framework adapter assigned. The
// names and order come from the taxonomy, which is plain data, so this file
// pulls nothing of the parser into the browser bundle.

import { CLASSIFIABLE_ROLES, FRAMEWORKS, ROLES, type FrameworkId, type RoleId } from "@/parser/taxonomy";
import type { FileNode } from "@/parser/types";

export interface FileCategory {
  id: RoleId;
  /** What the rail shows: the concrete role, e.g. "Controllers". */
  name: string;
  color: string;
  fileCount: number;
}

/** A role's colour, the same on the rail, the map and the detail pane. */
export function roleColor(role: RoleId): string {
  return ROLES[role].color;
}

/**
 * One entry per role present, in the framework's fixed reading order: never
 * re-sorted by count, so a repository's categories always sit in the same
 * places. Roles classification gave that the framework doesn't list (a
 * utility in a Next.js app) follow, in their own fixed order. Roles no file
 * has are left out. The counts add up to the file count.
 */
export function categoriesOf(framework: FrameworkId, files: readonly Pick<FileNode, "role">[]): FileCategory[] {
  const counts = new Map<RoleId, number>();
  for (const file of files) counts.set(file.role, (counts.get(file.role) ?? 0) + 1);
  const order = [...new Set<RoleId>([...FRAMEWORKS[framework].roles, ...CLASSIFIABLE_ROLES])];
  return order
    .filter((id) => counts.has(id))
    .map((id) => ({ id, name: ROLES[id].name, color: ROLES[id].color, fileCount: counts.get(id)! }));
}
