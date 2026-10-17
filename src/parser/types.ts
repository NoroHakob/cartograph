// The parser's output contract. Everything built after the parser reads this
// shape, so changes here are breaking changes: bump PARSE_RESULT_VERSION.

import type { FrameworkId, RoleId } from "./taxonomy.ts";

export type { FrameworkId, RoleId } from "./taxonomy.ts";

/** 2: files carry a role, routes carry a line, the adapter id is a FrameworkId. */
export const PARSE_RESULT_VERSION = 2;

/** Matches the `language` check on the `files` table. */
export type Language = "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts";

/** A file that became a node on the map. Paths are POSIX, relative to the root. */
export interface FileNode {
  path: string;
  /** Directory containing the file; "." for the repository root. */
  folder: string;
  language: Language;
  lineCount: number;
  /** sha256 of the raw bytes, hex. */
  hash: string;
  /** `dir` of the module (package) the file belongs to. */
  module: string;
  fanIn: number;
  fanOut: number;
  /** What the adapter says the file is, from its path, name or directives. One per file. */
  role: RoleId;
}

/**
 * A module is a package: the nearest directory at or above a file that holds
 * a package.json. A repository without one is a single module rooted at ".".
 */
export interface Module {
  dir: string;
  /** `name` from package.json, or the directory name when there is none. */
  name: string;
  hasPackageJson: boolean;
  fileCount: number;
}

export type ExcludedFileReason =
  | "declaration-file" // .d.ts and friends describe code, they aren't code
  | "minified" // *.min.js: a build artifact checked in
  | "too-large" // over MAX_FILE_BYTES, almost always generated
  | "unreadable"; // the bytes couldn't be read as text

/** A source-looking file inside a kept directory that did not become a node. */
export interface ExcludedFile {
  path: string;
  reason: ExcludedFileReason;
}

/** The three syntactic forms that produce edges. */
export type ImportKind =
  | "static" // import ... from "x", import "x", import x = require("x")
  | "reexport" // export ... from "x"
  | "dynamic"; // import("x")

export type ExternalKind =
  | "builtin" // node:fs, path, ...
  | "package" // a dependency, installed or declared in a package.json
  | "outside-root" // a path that leaves the repository
  | "url"; // https://... specifiers

export type ExclusionReason =
  | ExcludedFileReason
  | "ignored-path" // matched by .gitignore
  | "non-source-file"; // exists, but isn't TS/JS (css, svg, json, ...)

export type UnresolvedReason =
  | "non-literal-specifier" // import(expr): the target isn't knowable statically
  | "file-not-found" // relative or absolute path with nothing behind it
  | "alias-target-not-found" // a tsconfig `paths` pattern matched, no file did
  | "workspace-entry-not-found" // names a package in this repo, entry missing
  | "subpath-import-not-found" // "#x" with no matching package.json `imports`
  | "undeclared-package" // bare name, not installed, not in any package.json
  | "unknown-alias"; // not a path, not a valid package name, no alias matches

export type Resolution =
  | { status: "internal"; target: string }
  | { status: "external"; kind: ExternalKind; packageName?: string; installed?: boolean }
  | { status: "excluded"; reason: ExclusionReason; target: string }
  | { status: "unresolved"; reason: UnresolvedReason; detail?: string };

/** One import as written in the source, and what became of it. */
export interface ImportRecord {
  source: string;
  /** The literal specifier, or the source text of the expression when non-literal. */
  specifier: string;
  kind: ImportKind;
  typeOnly: boolean;
  /** 1-based. */
  line: number;
  resolution: Resolution;
}

/** A connection between two nodes, after duplicates are removed. */
export interface Edge {
  source: string;
  target: string;
  /** Every form this pair was seen in, sorted. */
  kinds: ImportKind[];
  /** True only when every import between the pair is type-only. */
  typeOnly: boolean;
  /** How many import records collapsed into this edge. */
  occurrences: number;
}

export interface ImportExample {
  source: string;
  line: number;
  specifier: string;
  detail?: string;
}

export interface CoverageBucket {
  count: number;
  examples: ImportExample[];
}

export interface Coverage {
  total: number;
  internal: number;
  external: number;
  excluded: number;
  unresolved: number;
  /** Share of imports that were classified, i.e. not unresolved. 1 when there are none. */
  classifiedRatio: number;
  externalByKind: Partial<Record<ExternalKind, CoverageBucket>>;
  excludedByReason: Partial<Record<ExclusionReason, CoverageBucket>>;
  unresolvedByReason: Partial<Record<UnresolvedReason, CoverageBucket>>;
}

export interface EntryPoint {
  /** A node path when the entry resolved to one, otherwise null. */
  path: string | null;
  /** Where the adapter found it, e.g. "package.json#bin". */
  origin: string;
  /** What was written there, relative to the package. */
  declared: string;
}

/** Matches the `kind` check on the `routes` table. */
export type RouteKind = "page" | "layout" | "route_handler" | "middleware" | "api";

/**
 * A route the framework serves. Adapters emit one only when both the method
 * and the full path pattern are read straight from syntax or file paths; a
 * route that would need guessing is left out, never approximated.
 */
export interface Route {
  file: string;
  /** The full pattern in the framework's own syntax, e.g. "/users/:id" or "/blog/[slug]". */
  path: string;
  kind: RouteKind;
  methods: string[];
  /** 1-based line of the code that declares it; null when the file's path alone declares it. */
  line: number | null;
}

export interface ConfigNote {
  /** The tsconfig/jsconfig the note is about. */
  config: string;
  message: string;
}

export interface ParseResult {
  version: typeof PARSE_RESULT_VERSION;
  /** Absolute path that was parsed. Informational only. */
  root: string;
  adapter: { id: FrameworkId; name: string };
  modules: Module[];
  files: FileNode[];
  excludedFiles: ExcludedFile[];
  imports: ImportRecord[];
  edges: Edge[];
  coverage: Coverage;
  entryPoints: EntryPoint[];
  routes: Route[];
  /** Problems reading tsconfig files. Resolution continues with what parsed. */
  configNotes: ConfigNote[];
  stats: { durationMs: number; duplicateImportsCollapsed: number };
}
