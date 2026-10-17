import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import type { ExcludedFile, ExcludedFileReason, Language, Module } from "./types.ts";

/** Files bigger than this are generated far more often than they are written. */
export const MAX_FILE_BYTES = 1024 * 1024;

/** Never descended into, whatever .gitignore says. */
const ALWAYS_SKIPPED_DIRS = new Set([".git", "node_modules"]);

const LANGUAGE_BY_EXTENSION: Record<string, Language> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".jsx": "jsx",
  ".mjs": "mjs",
  ".cjs": "cjs",
  ".mts": "mts",
  ".cts": "cts",
};

const DECLARATION_FILE = /\.d\.[mc]?ts$|\.d\.[^/]+\.ts$/;

export function languageOf(file: string): Language | undefined {
  return LANGUAGE_BY_EXTENSION[path.posix.extname(file)];
}

export function isDeclarationFile(file: string): boolean {
  return DECLARATION_FILE.test(file);
}

/** A file kept as a node, with its contents already read. */
export interface WalkedFile {
  path: string;
  folder: string;
  language: Language;
  text: string;
  lineCount: number;
  hash: string;
}

export interface WalkResult {
  files: WalkedFile[];
  excludedFiles: ExcludedFile[];
  /** Every tsconfig*.json / jsconfig*.json in a kept directory. */
  configFiles: string[];
  /** Directory -> parsed package.json, for every package.json in a kept directory. */
  packageJsons: Map<string, PackageJson>;
  /** Every file seen in a kept directory, source or not. */
  allFiles: Set<string>;
  isIgnored(relPath: string): boolean;
}

export interface PackageJson {
  name?: unknown;
  main?: unknown;
  module?: unknown;
  browser?: unknown;
  bin?: unknown;
  exports?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  optionalDependencies?: unknown;
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  // A trailing newline ends the last line rather than starting a new one.
  if (text.charCodeAt(text.length - 1) === 10) lines--;
  return lines;
}

/**
 * Walks every directory under `root` that isn't ignored, keeping whole
 * directories rather than picking files, so an import between two kept files
 * can never point at a node that was dropped.
 */
export function walkRepository(root: string): WalkResult {
  const ignores = new Map<string, Ignore>();
  const files: WalkedFile[] = [];
  const excludedFiles: ExcludedFile[] = [];
  const configFiles: string[] = [];
  const packageJsons = new Map<string, PackageJson>();
  const allFiles = new Set<string>();

  const isIgnored = (relPath: string, isDir = false): boolean => {
    const parts = relPath.split("/");
    // Git can't re-include a file whose parent directory is excluded, so any
    // ignored ancestor settles it.
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join("/");
      if (i < parts.length || isDir) {
        if (ALWAYS_SKIPPED_DIRS.has(parts[i - 1])) return true;
      }
      if (matchIgnored(ignores, sub, i < parts.length || isDir)) return true;
    }
    return false;
  };

  const visit = (dirRel: string) => {
    const dirAbs = dirRel === "." ? root : path.join(root, dirRel);
    const entries = readdirSync(dirAbs, { withFileTypes: true });

    const gitignore = entries.find((e) => e.isFile() && e.name === ".gitignore");
    if (gitignore) {
      ignores.set(dirRel, ignore().add(readFileSync(path.join(dirAbs, ".gitignore"), "utf8")));
    }

    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = dirRel === "." ? entry.name : `${dirRel}/${entry.name}`;
      // Symlinks are skipped: they can loop, and they point at content that
      // is either elsewhere in the tree already or outside it.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (ALWAYS_SKIPPED_DIRS.has(entry.name)) continue;
        if (matchIgnored(ignores, rel, true)) continue;
        visit(rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (matchIgnored(ignores, rel, false)) continue;
      allFiles.add(rel);

      const abs = path.join(dirAbs, entry.name);
      if (/^(ts|js)config(\..+)?\.json$/.test(entry.name)) configFiles.push(rel);
      if (entry.name === "package.json") {
        const parsed = readPackageJson(abs);
        if (parsed) packageJsons.set(dirRel, parsed);
      }

      const language = languageOf(rel);
      if (!language) continue;

      const excluded = exclusionFor(rel, abs);
      if (excluded) {
        excludedFiles.push({ path: rel, reason: excluded });
        continue;
      }

      const bytes = readFileSync(abs);
      const text = bytes.toString("utf8");
      if (text.includes("\u0000")) {
        excludedFiles.push({ path: rel, reason: "unreadable" });
        continue;
      }
      files.push({
        path: rel,
        folder: dirRel,
        language,
        text,
        lineCount: countLines(text),
        hash: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  };

  visit(".");
  return { files, excludedFiles, configFiles, packageJsons, allFiles, isIgnored: (p) => isIgnored(p) };
}

function exclusionFor(rel: string, abs: string): ExcludedFileReason | undefined {
  if (isDeclarationFile(rel)) return "declaration-file";
  if (/\.min\.[cm]?js$/.test(rel)) return "minified";
  if (statSync(abs).size > MAX_FILE_BYTES) return "too-large";
  return undefined;
}

/** Applies .gitignore files from the root down; deeper files override shallower ones. */
function matchIgnored(ignores: Map<string, Ignore>, relPath: string, isDir: boolean): boolean {
  let ignored = false;
  for (const [dir, ig] of ignores) {
    if (dir !== "." && !relPath.startsWith(`${dir}/`)) continue;
    const local = dir === "." ? relPath : relPath.slice(dir.length + 1);
    const result = ig.test(isDir ? `${local}/` : local);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

function readPackageJson(abs: string): PackageJson | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(abs, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as PackageJson) : undefined;
  } catch {
    return undefined;
  }
}

/** Assigns each file to the nearest directory at or above it holding a package.json. */
export function assignModules(
  rootName: string,
  files: WalkedFile[],
  packageJsons: Map<string, PackageJson>,
): { moduleOf: Map<string, string>; modules: Module[] } {
  const moduleOf = new Map<string, string>();
  const counts = new Map<string, number>();

  for (const file of files) {
    let dir = file.folder;
    while (dir !== "." && !packageJsons.has(dir)) dir = parentDir(dir);
    moduleOf.set(file.path, dir);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }

  const modules: Module[] = [...counts.keys()].sort().map((dir) => {
    const pkg = packageJsons.get(dir);
    const name = typeof pkg?.name === "string" ? pkg.name : dir === "." ? rootName : path.posix.basename(dir);
    return { dir, name, hasPackageJson: pkg !== undefined, fileCount: counts.get(dir) ?? 0 };
  });
  return { moduleOf, modules };
}

export function parentDir(dir: string): string {
  const i = dir.lastIndexOf("/");
  return i === -1 ? "." : dir.slice(0, i);
}
