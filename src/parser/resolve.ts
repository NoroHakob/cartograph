import { existsSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { ts } from "ts-morph";
import type { ConfigLookup } from "./tsconfig.ts";
import { toRel, tsPath } from "./tsconfig.ts";
import type { ExcludedFileReason, ImportKind, Resolution } from "./types.ts";
import { isDeclarationFile, parentDir, type PackageJson } from "./walk.ts";

export interface ResolverInput {
  root: string;
  nodes: Set<string>;
  excludedFiles: Map<string, ExcludedFileReason>;
  packageJsons: Map<string, PackageJson>;
  isIgnored(relPath: string): boolean;
  configs: ConfigLookup;
}

export type Resolve = (source: string, specifier: string, kind: ImportKind) => Resolution;

const BUILTINS = new Set(builtinModules);
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
// npm's rules for new package names: lowercase, URL-safe, no ~'!()*, and not
// starting with "." or "_". Anything else written as a bare specifier is an alias.
const PACKAGE_NAME = /^(?:@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*$/;

export function createResolver(input: ResolverInput): Resolve {
  const { root, nodes, configs } = input;

  const workspacePackages = new Map<string, string>();
  for (const [dir, pkg] of input.packageJsons) {
    if (typeof pkg.name === "string" && !workspacePackages.has(pkg.name)) workspacePackages.set(pkg.name, dir);
  }

  const declaredCache = new Map<string, Set<string>>();
  const declaredFor = (dir: string): Set<string> => {
    const cached = declaredCache.get(dir);
    if (cached) return cached;
    const own = new Set<string>();
    const pkg = input.packageJsons.get(dir);
    for (const field of DEPENDENCY_FIELDS) {
      const deps = pkg?.[field];
      if (deps && typeof deps === "object") for (const name of Object.keys(deps)) own.add(name);
    }
    const all = dir === "." ? own : new Set([...own, ...declaredFor(parentDir(dir))]);
    declaredCache.set(dir, all);
    return all;
  };

  const classifyFile = (abs: string): Resolution => {
    const rel = toRel(root, abs);
    if (rel === null) {
      const pkg = packageFromNodeModulesPath(abs);
      return pkg ? { status: "external", kind: "package", packageName: pkg, installed: true } : { status: "external", kind: "outside-root" };
    }
    const pkg = packageFromNodeModulesPath(rel);
    if (pkg) return { status: "external", kind: "package", packageName: pkg, installed: true };
    if (nodes.has(rel)) return { status: "internal", target: rel };
    if (isDeclarationFile(rel)) {
      // A checked-in .d.ts next to the .js it describes: the import reaches the .js.
      const sibling = jsSiblingOf(rel).find((candidate) => nodes.has(candidate));
      if (sibling) return { status: "internal", target: sibling };
    }
    const excluded = input.excludedFiles.get(rel);
    if (excluded) return { status: "excluded", reason: excluded, target: rel };
    if (input.isIgnored(rel)) return { status: "excluded", reason: "ignored-path", target: rel };
    return { status: "excluded", reason: "non-source-file", target: rel };
  };

  return (source, specifier, kind) => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(specifier)) return { status: "external", kind: "url" };
    if (specifier.startsWith("node:") || BUILTINS.has(specifier) || BUILTINS.has(specifier.split("/")[0])) {
      return { status: "external", kind: "builtin" };
    }
    if (specifier.startsWith("npm:")) {
      return { status: "external", kind: "package", packageName: packageNameOf(specifier.slice(4).replace(/@[^@/]*$/, "")) };
    }

    const sourceAbs = path.join(root, source);
    const sourceTs = tsPath(sourceAbs);
    const config = configs.forFile(source);
    const mode =
      kind === "dynamic"
        ? ts.ModuleKind.ESNext
        : ts.getImpliedNodeFormatForFile(sourceTs, config.cache.getPackageJsonInfoCache(), ts.sys, config.options);
    const resolved = ts.resolveModuleName(specifier, sourceTs, config.options, ts.sys, config.cache, undefined, mode)
      .resolvedModule;
    if (resolved) return classifyFile(resolved.resolvedFileName);

    // TypeScript found nothing. Work out why, from evidence on disk only.
    const bare = stripQuery(specifier);
    if (bare.startsWith(".") || bare.startsWith("/") || path.isAbsolute(bare)) {
      const targetAbs = bare.startsWith("/") ? path.join(root, bare) : path.resolve(path.dirname(sourceAbs), bare);
      if (isFile(targetAbs)) return classifyFile(targetAbs);
      if (toRel(root, targetAbs) === null && targetAbs !== root) {
        return { status: "unresolved", reason: "file-not-found", detail: "path leaves the repository and nothing is there" };
      }
      return { status: "unresolved", reason: "file-not-found" };
    }

    if (bare.startsWith("#")) return { status: "unresolved", reason: "subpath-import-not-found" };

    const alias = matchingPathAlias(config.options.paths, bare);
    if (alias) {
      return {
        status: "unresolved",
        reason: "alias-target-not-found",
        detail: `matched "${alias}" in ${config.file ?? "default config"}`,
      };
    }

    const name = packageNameOf(bare);
    const workspaceDir = name ? workspacePackages.get(name) : undefined;
    if (name && workspaceDir !== undefined) {
      const subpath = bare.slice(name.length);
      const local = workspaceDir === "." ? `.${subpath || "/"}` : `./${workspaceDir}${subpath}`;
      const inRepo = ts.resolveModuleName(local, tsPath(path.join(root, "__cartograph__.ts")), config.options, ts.sys).resolvedModule;
      if (inRepo) return classifyFile(inRepo.resolvedFileName);
      return { status: "unresolved", reason: "workspace-entry-not-found", detail: `package "${name}" lives at ${workspaceDir}` };
    }

    if (!name || !PACKAGE_NAME.test(name)) return { status: "unresolved", reason: "unknown-alias" };

    if (isInstalled(root, parentDir(source), name)) {
      return { status: "external", kind: "package", packageName: name, installed: true };
    }
    const declared = declaredFor(nearestPackageDir(input.packageJsons, source));
    if (declared.has(name) || declared.has(typesPackageFor(name))) {
      return { status: "external", kind: "package", packageName: name, installed: false };
    }
    return { status: "unresolved", reason: "undeclared-package", detail: `"${name}" is in no package.json` };
  };
}

function stripQuery(specifier: string): string {
  const q = specifier.indexOf("?");
  return q === -1 ? specifier : specifier.slice(0, q);
}

function isFile(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

/** "@scope/pkg/sub" -> "@scope/pkg", "pkg/sub" -> "pkg". */
export function packageNameOf(specifier: string): string | undefined {
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.length >= 2 && parts[0].length > 1 ? `${parts[0]}/${parts[1]}` : undefined;
  return parts[0] || undefined;
}

function typesPackageFor(name: string): string {
  return name.startsWith("@") ? `@types/${name.slice(1).replace("/", "__")}` : `@types/${name}`;
}

function packageFromNodeModulesPath(p: string): string | undefined {
  const parts = p.split(/[\\/]/);
  const i = parts.lastIndexOf("node_modules");
  if (i === -1 || i + 1 >= parts.length) return undefined;
  return parts[i + 1].startsWith("@") ? `${parts[i + 1]}/${parts[i + 2] ?? ""}` : parts[i + 1];
}

function jsSiblingOf(declaration: string): string[] {
  const m = /^(.*)\.d\.([mc]?)ts$/.exec(declaration);
  if (!m) return [];
  const [, base, flavour] = m;
  return flavour ? [`${base}.${flavour}js`] : [`${base}.js`, `${base}.jsx`];
}

/** The `paths` pattern a specifier matches, ignoring a bare "*" catch-all. */
function matchingPathAlias(paths: ts.MapLike<string[]> | undefined, specifier: string): string | undefined {
  if (!paths) return undefined;
  for (const pattern of Object.keys(paths)) {
    if (pattern === "*") continue;
    const star = pattern.indexOf("*");
    if (star === -1 ? specifier === pattern : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1))) {
      return pattern;
    }
  }
  return undefined;
}

function isInstalled(root: string, fromDir: string, name: string): boolean {
  let dir = fromDir;
  for (;;) {
    const base = dir === "." ? root : path.join(root, dir);
    if (existsSync(path.join(base, "node_modules", name))) return true;
    if (dir === ".") return false;
    dir = parentDir(dir);
  }
}

function nearestPackageDir(packageJsons: Map<string, PackageJson>, file: string): string {
  let dir = parentDir(file);
  while (dir !== "." && !packageJsons.has(dir)) dir = parentDir(dir);
  return dir;
}
