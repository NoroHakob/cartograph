import type { EntryPoint } from "../types";
import type { Adapter, RepoContext } from "./adapter";

/**
 * The fallback: assumes no framework at all. Entry points come only from what
 * package.json declares, which is Node's packaging, not a framework's. There
 * are no routes, because without a framework nothing turns a file into one.
 */
export const noFrameworkAdapter: Adapter = {
  id: "none",
  name: "No framework",
  detect: () => true,
  entryPoints: (repo) => repo.modules.flatMap((mod) => packageEntryPoints(repo, mod.dir)),
  routes: () => [],
};

function packageEntryPoints(repo: RepoContext, dir: string): EntryPoint[] {
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
