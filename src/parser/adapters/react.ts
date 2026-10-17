import { FRAMEWORKS, type RoleId } from "../taxonomy.ts";
import type { Language } from "../types.ts";
import type { Adapter } from "./adapter.ts";
import { holdsShare, isComponentFile, isHookFile, packagesDeclaring } from "./conventions.ts";
import { entryPaths, genericRole, packageEntryPoints } from "./none.ts";

/**
 * React without a meta-framework. React has no file conventions of its own,
 * so the only roles are the ones the language and the Rules of Hooks name:
 * JSX files are components, `use*` files are hooks. React routes nothing by
 * itself, so there are no routes.
 */
export const reactAdapter: Adapter = {
  id: "react",
  name: FRAMEWORKS.react.name,
  // A dependency or a peer dependency: an app or a component library. Only in
  // devDependencies, it's there for tests or docs, not what the code is.
  detect: (repo) => holdsShare(repo, packagesDeclaring(repo, "react", ["dependencies", "peerDependencies"])),
  entryPoints: (repo) => repo.modules.flatMap((mod) => packageEntryPoints(repo, mod.dir)),
  roles: (repo, entryPoints) => {
    const entries = entryPaths(entryPoints);
    return new Map(repo.files.map((f) => [f.path, genericRole(f.path, entries) ?? reactRole(f.path, f.language) ?? "other"]));
  },
  routes: () => [],
};

/** Hooks, then components. Shared with the Next.js adapter. */
export function reactRole(file: string, language: Language): RoleId | undefined {
  if (isHookFile(file)) return "hook";
  if (isComponentFile(language)) return "component";
  return undefined;
}
