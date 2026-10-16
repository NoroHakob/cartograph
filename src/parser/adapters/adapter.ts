import type { Edge, EntryPoint, FileNode, Module, Route } from "../types";
import type { PackageJson } from "../walk";

/** What an adapter is allowed to see: the finished graph and the files on disk. */
export interface RepoContext {
  root: string;
  files: readonly FileNode[];
  edges: readonly Edge[];
  modules: readonly Module[];
  packageJsons: ReadonlyMap<string, PackageJson>;
  /** True when `relPath` is a node. */
  hasNode(relPath: string): boolean;
  /**
   * Finds the node a package-relative path refers to, the way Node resolves a
   * `main` field: the exact file, then with a source extension, then as a
   * directory index. Returns null rather than guessing further.
   */
  findNode(relPath: string): string | null;
}

/**
 * Framework knowledge, kept out of the parser proper. An adapter reads the
 * graph the parser built and labels parts of it. It never adds, removes or
 * changes nodes or edges.
 */
export interface Adapter {
  readonly id: string;
  readonly name: string;
  /** Whether this adapter applies to the repository. */
  detect(repo: RepoContext): boolean;
  /** Files the repository is entered through. */
  entryPoints(repo: RepoContext): EntryPoint[];
  /** Routes the framework derives from files. */
  routes(repo: RepoContext): Route[];
}
