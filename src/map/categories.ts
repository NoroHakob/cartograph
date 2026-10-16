// Categories of file. For now a file's category is its extension, which the
// parser already records as `language`. Role-based categories come later.

import type { FileNode, Language } from "@/parser/types";

export interface FileCategory {
  id: Language;
  /** What the rail shows, e.g. ".tsx". */
  name: string;
  /** Mid-tone colours that read on both the light and the dark surface. */
  color: string;
  fileCount: number;
}

export const CATEGORY_COLORS: Record<Language, string> = {
  ts: "#3b82c4",
  tsx: "#16a3a8",
  js: "#d0a12a",
  jsx: "#e07a3a",
  mjs: "#9b6ad6",
  cjs: "#b5664f",
  mts: "#5b6fe0",
  cts: "#7d8a99",
};

/** One entry per extension present, largest first, ties by name. */
export function categoriesOf(files: readonly Pick<FileNode, "language">[]): FileCategory[] {
  const counts = new Map<Language, number>();
  for (const file of files) counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
  return [...counts]
    .map(([id, fileCount]) => ({ id, name: `.${id}`, color: CATEGORY_COLORS[id], fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount || (a.id < b.id ? -1 : 1));
}
