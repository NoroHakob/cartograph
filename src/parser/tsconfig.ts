import path from "node:path";
import { ts } from "ts-morph";
import type { ConfigNote } from "./types.ts";
import { parentDir } from "./walk.ts";

export interface LoadedConfig {
  /** Repo-relative path of the config, or null for the built-in default. */
  file: string | null;
  options: ts.CompilerOptions;
  cache: ts.ModuleResolutionCache;
}

export interface ConfigLookup {
  forFile(relPath: string): LoadedConfig;
  notes: ConfigNote[];
}

/** Used for files no tsconfig/jsconfig claims. */
const DEFAULT_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
};

/**
 * Reads every tsconfig/jsconfig in the repository and works out which one
 * governs each file, so `paths`, `baseUrl` and `moduleResolution` come from
 * the project's own settings.
 *
 * A file belongs to the config in the deepest directory whose file list
 * includes it. A file no config includes falls back to the nearest
 * tsconfig.json/jsconfig.json above it, then to the defaults.
 */
export function loadConfigs(root: string, configFiles: string[]): ConfigLookup {
  const notes: ConfigNote[] = [];
  const loaded = new Map<string, LoadedConfig>();
  const claims = new Map<string, { config: LoadedConfig; depth: number }>();

  // tsconfig.json before tsconfig.app.json etc., so the base name wins ties.
  const ordered = [...configFiles].sort((a, b) => {
    const da = a.split("/").length;
    const db = b.split("/").length;
    if (da !== db) return da - db;
    const ba = /^[tj]sconfig\.json$/.test(path.posix.basename(a)) ? 0 : 1;
    const bb = /^[tj]sconfig\.json$/.test(path.posix.basename(b)) ? 0 : 1;
    return ba - bb || (a < b ? -1 : a > b ? 1 : 0);
  });

  for (const rel of ordered) {
    const abs = tsPath(path.join(root, rel));
    const read = ts.readConfigFile(abs, ts.sys.readFile);
    if (read.error) {
      notes.push({ config: rel, message: flatten(read.error) });
      continue;
    }
    let parsed: ts.ParsedCommandLine;
    try {
      parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.posix.dirname(abs), undefined, abs);
    } catch (error) {
      notes.push({ config: rel, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    for (const diagnostic of parsed.errors) {
      // "No inputs were found" is normal for solution-style configs.
      if (diagnostic.code === 18003) continue;
      notes.push({ config: rel, message: flatten(diagnostic) });
    }
    const options = normalise(parsed.options);
    const config: LoadedConfig = {
      file: rel,
      options,
      cache: ts.createModuleResolutionCache(path.posix.dirname(abs), (s) => s, options),
    };
    loaded.set(rel, config);

    const depth = rel.split("/").length;
    for (const fileName of parsed.fileNames) {
      const fileRel = toRel(root, fileName);
      if (fileRel === null) continue;
      const existing = claims.get(fileRel);
      if (!existing || existing.depth < depth) claims.set(fileRel, { config, depth });
    }
  }

  const fallback: LoadedConfig = {
    file: null,
    options: DEFAULT_OPTIONS,
    cache: ts.createModuleResolutionCache(tsPath(root), (s) => s, DEFAULT_OPTIONS),
  };

  const nearest = (relPath: string): LoadedConfig => {
    let dir = parentDir(relPath);
    for (;;) {
      for (const name of ["tsconfig.json", "jsconfig.json"]) {
        const candidate = loaded.get(dir === "." ? name : `${dir}/${name}`);
        if (candidate) return candidate;
      }
      if (dir === ".") return fallback;
      dir = parentDir(dir);
    }
  };

  return {
    notes,
    forFile: (relPath) => claims.get(relPath)?.config ?? nearest(relPath),
  };
}

/**
 * The parser reads JS as well as TS, so it always resolves .js files. Classic
 * resolution (TypeScript's default for some `module` settings) can't find
 * index files or packages, which no real toolchain does, so it is upgraded.
 */
function normalise(options: ts.CompilerOptions): ts.CompilerOptions {
  const next: ts.CompilerOptions = { ...options, allowJs: true };
  const kind = options.moduleResolution;
  if (kind === undefined || kind === ts.ModuleResolutionKind.Classic) {
    next.moduleResolution = ts.ModuleResolutionKind.Bundler;
    next.module = ts.ModuleKind.ESNext;
  }
  return next;
}

function flatten(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

/** TypeScript's internals expect forward slashes, Windows included. */
export function tsPath(abs: string): string {
  return abs.split(path.sep).join("/");
}

export function toRel(root: string, abs: string): string | null {
  const rel = path.relative(root, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}
