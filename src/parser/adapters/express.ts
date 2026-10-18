import { FRAMEWORKS, type RoleId } from "../taxonomy.ts";
import type { Adapter } from "./adapter.ts";
import { holdsShare, packagesDeclaring } from "./conventions.ts";
import { entryPaths, genericRole, packageEntryPoints } from "./none.ts";

/**
 * Express. Express has no file conventions of its own, but its applications
 * share one: code sorted into `routes/`, `controllers/`, `models/` and so on.
 * Roles come from those directory names. Both the singular and the plural
 * count, because real repositories use both (`middleware/`, `middlewares/`).
 *
 * There are no routes. Express assembles them at runtime from routers,
 * variables and middleware chains, so neither a full path nor, often, a
 * method can be read from the syntax without guessing.
 */
export const expressAdapter: Adapter = {
  id: "express",
  name: FRAMEWORKS.express.name,
  // Only in devDependencies, Express is a test or docs server, not the app.
  detect: (repo) => holdsShare(repo, packagesDeclaring(repo, "express", ["dependencies", "peerDependencies"])),
  entryPoints: (repo) => repo.modules.flatMap((mod) => packageEntryPoints(repo, mod.dir)),
  roles: (repo, entryPoints) => {
    const entries = entryPaths(entryPoints);
    const packages = packagesDeclaring(repo, "express", ["dependencies", "peerDependencies"]);
    return new Map(
      repo.files.map((f) => {
        const role = genericRole(f.path, entries) ?? (packages.has(f.module) ? directoryRole(f.path, f.module) : undefined);
        return [f.path, role ?? "other"];
      }),
    );
  },
  routes: () => [],
};

/** Directory names and the role each gives the files under it. */
const DIRECTORY_ROLES: Record<string, RoleId> = {
  route: "route",
  routes: "route",
  router: "route",
  routers: "route",
  controller: "controller",
  controllers: "controller",
  service: "service",
  services: "service",
  model: "model",
  models: "model",
  middleware: "middleware",
  middlewares: "middleware",
  config: "config",
  configs: "config",
};

/**
 * The role of the nearest enclosing directory with a conventional name, inside
 * the file's own package: `src/routes/v1/auth.route.js` is a route. The
 * nearest wins, so `routes/middleware/auth.js` is middleware. Undefined when
 * no directory between the package and the file has such a name.
 */
export function directoryRole(file: string, moduleDir: string): RoleId | undefined {
  const inPackage = moduleDir === "." ? file : file.slice(moduleDir.length + 1);
  const dirs = inPackage.split("/").slice(0, -1);
  for (let i = dirs.length - 1; i >= 0; i--) {
    const name = dirs[i].toLowerCase();
    if (Object.hasOwn(DIRECTORY_ROLES, name)) return DIRECTORY_ROLES[name];
  }
  return undefined;
}
