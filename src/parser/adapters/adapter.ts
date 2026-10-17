import type { SourceFile } from "ts-morph";
import type { FrameworkId, RoleId } from "../taxonomy.ts";
import type { Edge, EntryPoint, FileNode, Module, Route } from "../types.ts";
import type { PackageJson } from "../walk.ts";

/** What an adapter is allowed to see: the finished graph and the files on disk. */
export interface RepoContext {
  root: string;
  /** Every node, without a role yet: assigning one is the adapter's job. */
  files: readonly Omit<FileNode, "role">[];
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
  /** A node's source text, exactly as read from disk. */
  text(relPath: string): string;
  /**
   * A node parsed as syntax only: nothing is resolved or type-checked. The
   * tree is shared; adapters read it and never change it.
   */
  syntax(relPath: string): SourceFile;
}

/**
 * Framework knowledge, kept out of the parser proper. An adapter reads the
 * graph the parser built and labels parts of it. It never adds, removes or
 * changes nodes or edges.
 */
export interface Adapter {
  readonly id: FrameworkId;
  readonly name: string;
  /** Whether this adapter applies to the repository. */
  detect(repo: RepoContext): boolean;
  /** Files the repository is entered through. */
  entryPoints(repo: RepoContext): EntryPoint[];
  /**
   * One role per node, every one of them from FRAMEWORKS[id].roles. Reads
   * paths, file names and syntax; never what the code does when it runs.
   */
  roles(repo: RepoContext, entryPoints: readonly EntryPoint[]): Map<string, RoleId>;
  /** Routes the framework serves. Exact or absent: see Route. */
  routes(repo: RepoContext): Route[];
}
