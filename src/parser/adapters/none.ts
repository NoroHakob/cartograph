import type { RoleId } from "../taxonomy.ts";
import { FRAMEWORKS } from "../taxonomy.ts";
import type { EntryPoint } from "../types.ts";
import type { Adapter, RepoContext } from "./adapter.ts";
import { isConfigFile, isTestFile } from "./conventions.ts";

/**
 * The fallback: assumes no framework at all. Entry points come only from what
 * package.json declares, which is Node's packaging, not a framework's. Roles
 * are the generic ones every toolchain shares. There are no routes, because
 * without a framework nothing turns a file into one.
 */
export const noFrameworkAdapter: Adapter = {
  id: "none",
  name: FRAMEWORKS.none.name,
  detect: () => true,
  entryPoints: (repo) => repo.modules.flatMap((mod) => packageEntryPoints(repo, mod.dir)),
  roles: (repo, entryPoints) => {
    const entries = entryPaths(entryPoints);
    return new Map(repo.files.map((f) => [f.path, genericRole(f.path, entries) ?? "source"]));
  },
  routes: () => [],
};

/** The nodes entry points resolved to. */
export function entryPaths(entryPoints: readonly EntryPoint[]): Set<string> {
  return new Set(entryPoints.flatMap((e) => (e.path === null ? [] : [e.path])));
}

/**
 * Roles any repository can have, in precedence order: a test is a test even
 * when package.json points at it. Undefined when none applies.
 */
export function genericRole(file: string, entries: ReadonlySet<string>): RoleId | undefined {
  if (isTestFile(file)) return "test";
  if (isConfigFile(file)) return "config";
  if (entries.has(file)) return "entry";
  return undefined;
}

export function packageEntryPoints(repo: RepoContext, dir: string): EntryPoint[] {
  const pkg = repo.packageJsons.get(dir);
  if (!pkg) return [];
  const where = dir === "." ? "package.json" : `${dir}/package.json`;
  const declared: { origin: string; value: string }[] = [];

  for (const field of ["main", "module", "browser"] as const) {
    const value = pkg[field];
    if (typeof value === "string") declared.push({ origin: `${where}#${field}`, value });
  }
  if (typeof pkg.bin === "string") declared.push({ origin: `${where}#bin`, value: pkg.bin });
  else if (pkg.bin && typeof pkg.bin === "object") {
    for (const value of Object.values(pkg.bin)) if (typeof value === "string") declared.push({ origin: `${where}#bin`, value });
  }
  for (const value of exportTargets(pkg.exports)) declared.push({ origin: `${where}#exports`, value });

  const seen = new Set<string>();
  const entries: EntryPoint[] = [];
  for (const { origin, value } of declared) {
    const key = `${origin}\u0000${value}`;
    if (seen.has(key) || value.includes("*")) continue;
    seen.add(key);
    const rel = joinPackagePath(dir, value);
    entries.push({ path: rel === null ? null : repo.findNode(rel), origin, declared: value });
  }
  return entries;
}

/** Every string target in an `exports` map, however deeply conditioned. */
function exportTargets(exports: unknown): string[] {
  if (typeof exports === "string") return [exports];
  if (Array.isArray(exports)) return exports.flatMap(exportTargets);
  if (exports && typeof exports === "object") return Object.values(exports).flatMap(exportTargets);
  return [];
}

function joinPackagePath(dir: string, value: string): string | null {
  const parts = (dir === "." ? [] : dir.split("/")).concat(value.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}
