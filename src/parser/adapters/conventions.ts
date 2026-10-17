// Naming and syntax rules more than one adapter reads. Each is a fact about a
// path, a file name or a file's own syntax; none looks at what code does.

import path from "node:path";
import { ts } from "ts-morph";
import { SCRIPT_KIND } from "../imports.ts";
import type { Language } from "../types.ts";
import type { PackageJson } from "../walk.ts";
import type { RepoContext } from "./adapter.ts";

// The test runners' and toolchains' own conventions, the same rules the
// detail pane uses. `.e2e-spec.ts` is Nest's.
const TEST_FILE = /[.-](test|spec)\.[cm]?[jt]sx?$/;
const TEST_DIR = /(^|\/)(__tests__|tests?)\//;
const CONFIG_FILE = /(^|\/)[^/]+\.config\.[cm]?[jt]s$/;
// The Rules of Hooks name: `use` and then a capital letter or digit.
const HOOK_FILE = /^use[A-Z0-9]/;

export function isTestFile(file: string): boolean {
  return TEST_FILE.test(file) || TEST_DIR.test(file);
}

export function isConfigFile(file: string): boolean {
  return CONFIG_FILE.test(file);
}

/** A file named for a hook: `useCart.ts`, `use-cart.ts` doesn't count. */
export function isHookFile(file: string): boolean {
  return HOOK_FILE.test(stem(file));
}

/** A .tsx or .jsx file: JSX is what a component is written in. */
export function isComponentFile(language: Language): boolean {
  return language === "tsx" || language === "jsx";
}

/** The file name without its last extension: `app/page.tsx` -> `page`. */
export function stem(file: string): string {
  const base = path.posix.basename(file);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? base : base.slice(0, dot);
}

export type Directive = "use client" | "use server";

/**
 * The file-level directives: string-literal statements at the very top of the
 * file, before any other statement. A "use server" inside a function body
 * marks that one function, not the file, and is not counted here.
 */
export function fileDirectives(file: string, language: Language, text: string): Set<Directive> {
  const found = new Set<Directive>();
  // Cheap filter: parsing is only worth it when the words are there at all.
  if (!text.includes("use client") && !text.includes("use server")) return found;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, SCRIPT_KIND[language]);
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    const value = statement.expression.text;
    if (value === "use client" || value === "use server") found.add(value);
  }
  return found;
}

type DependencyField = "dependencies" | "devDependencies" | "peerDependencies";

/**
 * The share of the repository's files a framework's packages must hold for
 * the framework to describe the repository. A benchmark or example folder
 * that depends on React doesn't make a 450-file library a React codebase; a
 * Next.js app in one corner of a monorepo still makes it a Next.js one.
 */
export const DETECTION_SHARE = 0.25;

/** Package directories whose package.json lists `name` under any of `fields`. */
export function packagesDeclaring(repo: Pick<RepoContext, "packageJsons">, name: string, fields: readonly DependencyField[]): Set<string> {
  const dirs = new Set<string>();
  for (const [dir, pkg] of repo.packageJsons) if (declares(pkg, name, fields)) dirs.add(dir);
  return dirs;
}

/** Whether the files in these packages make up at least DETECTION_SHARE of the repository. */
export function holdsShare(repo: Pick<RepoContext, "files">, dirs: ReadonlySet<string>): boolean {
  if (dirs.size === 0 || repo.files.length === 0) return false;
  const held = repo.files.filter((f) => dirs.has(f.module)).length;
  return held >= repo.files.length * DETECTION_SHARE;
}

/** Whether package.json lists `name` under any of `fields`. */
export function declares(pkg: PackageJson | undefined, name: string, fields: readonly DependencyField[]): boolean {
  if (!pkg) return false;
  return fields.some((field) => {
    const deps = pkg[field];
    return deps !== null && typeof deps === "object" && Object.hasOwn(deps, name);
  });
}
