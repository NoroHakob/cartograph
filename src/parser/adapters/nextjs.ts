import path from "node:path";
import { Node } from "ts-morph";
import { esmExports } from "../exports.ts";
import { FRAMEWORKS, type RoleId } from "../taxonomy.ts";
import type { Route } from "../types.ts";
import type { Adapter, RepoContext } from "./adapter.ts";
import { declares, fileDirectives, holdsShare, isConfigFile, isTestFile, stem } from "./conventions.ts";
import { packageEntryPoints } from "./none.ts";
import { reactRole } from "./react.ts";

/**
 * Next.js. Roles and routes both come from where a file sits in `app/` or
 * `pages/`, the way Next.js itself reads them. Server actions and client
 * components come from the file's own directive.
 */
export const nextjsAdapter: Adapter = {
  id: "nextjs",
  name: FRAMEWORKS.nextjs.name,
  detect: (repo) => holdsShare(repo, new Set(nextApps(repo).map((a) => a.dir))),
  entryPoints: (repo) => repo.modules.flatMap((mod) => packageEntryPoints(repo, mod.dir)),
  roles: (repo) => {
    const apps = nextApps(repo);
    return new Map(
      repo.files.map((f) => {
        if (isTestFile(f.path)) return [f.path, "test"];
        if (isConfigFile(f.path)) return [f.path, "config"];
        const app = apps.find((a) => a.dir === f.module);
        const placed = app ? placeInApp(app, f.path) : null;
        if (placed && placed.role) return [f.path, placed.role];
        const directives = fileDirectives(f.path, f.language, repo.text(f.path));
        if (directives.has("use server")) return [f.path, "server-action"];
        if (directives.has("use client")) return [f.path, "client-component"];
        return [f.path, reactRole(f.path, f.language) ?? "other"];
      }),
    );
  },
  routes: (repo) => nextApps(repo).flatMap((app) => appRoutes(repo, app)),
};

/** The extensions Next.js treats as pages unless `pageExtensions` says otherwise. */
const PAGE_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js"]);

const ROUTE_UI = new Set(["loading", "error", "global-error", "not-found", "forbidden", "unauthorized", "default"]);
const METADATA = /^(sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon)\d*$/;
/** What a route handler may export; Next.js answers any other method itself. */
const HANDLER_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]);

interface NextApp {
  /** The package directory: where package.json lists `next`. */
  dir: string;
  /** `app` and `pages`, at the package root or under `src/`, when they hold files. */
  appDir: string | null;
  pagesDir: string | null;
  config: NextConfig;
}

interface NextConfig {
  /** What every route is mounted under; "" for none. */
  basePath: string;
  /** False when next.config says something that changes routes in a way syntax can't settle. */
  routable: boolean;
  /** False when i18n prefixes every pages-router route with a locale. */
  pagesRoutable: boolean;
}

function nextApps(repo: RepoContext): NextApp[] {
  const apps: NextApp[] = [];
  for (const [dir, pkg] of repo.packageJsons) {
    if (!declares(pkg, "next", ["dependencies", "devDependencies"])) continue;
    const at = (sub: string) => (dir === "." ? sub : `${dir}/${sub}`);
    const holdsFiles = (sub: string) => repo.files.some((f) => f.path.startsWith(`${at(sub)}/`));
    // Next.js ignores src/app and src/pages when app or pages is at the root.
    const base = holdsFiles("app") || holdsFiles("pages") ? "" : "src/";
    apps.push({
      dir,
      appDir: holdsFiles(`${base}app`) ? at(`${base}app`) : null,
      pagesDir: holdsFiles(`${base}pages`) ? at(`${base}pages`) : null,
      config: readNextConfig(repo, dir),
    });
  }
  return apps;
}

/**
 * Reads next.config's own syntax for the three settings that move routes.
 * A basePath written as a string literal is applied; one computed any other
 * way, or any pageExtensions, means no route in the app can be stated exactly.
 */
function readNextConfig(repo: RepoContext, dir: string): NextConfig {
  const config: NextConfig = { basePath: "", routable: true, pagesRoutable: true };
  const file = [".js", ".mjs", ".cjs", ".ts", ".mts"].map((ext) => (dir === "." ? `next.config${ext}` : `${dir}/next.config${ext}`)).find((p) => repo.hasNode(p));
  if (!file) return config;

  const basePaths = new Set<string>();
  repo.syntax(file).forEachDescendant((node) => {
    if (!Node.isPropertyAssignment(node) && !Node.isShorthandPropertyAssignment(node)) return;
    const name = node.getName();
    if (name === "pageExtensions") config.routable = false;
    else if (name === "i18n") config.pagesRoutable = false;
    else if (name === "basePath") {
      const value = Node.isPropertyAssignment(node) ? node.getInitializer() : undefined;
      if (value && (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value))) basePaths.add(value.getLiteralValue());
      else config.routable = false;
    }
  });
  if (basePaths.size > 1) config.routable = false;
  else if (basePaths.size === 1) config.basePath = [...basePaths][0];
  return config;
}

type Segments = { kind: "path"; path: string } | { kind: "inexact" } | { kind: "private" };

/**
 * The URL an app-router folder serves. Route groups drop out. A private
 * `_folder` opts out of routing entirely. A parallel `@slot` renders inside
 * its parent's URL rather than at its own, and an intercepting `(.)folder`
 * serves a URL that depends on where navigation came from: neither has a
 * pattern of its own to state.
 */
function appSegments(dirs: readonly string[]): Segments {
  const out: string[] = [];
  for (const dir of dirs) {
    if (dir.startsWith("_")) return { kind: "private" };
    if (/^\((\.{1,3}|\.\.\)\(\.\.)\)/.test(dir)) return { kind: "inexact" };
    if (dir.startsWith("(") && dir.endsWith(")")) continue;
    if (dir.startsWith("@")) return { kind: "inexact" };
    // %5F is how a folder asks for a literal leading underscore.
    out.push(/^%5f/i.test(dir) ? `_${dir.slice(3)}` : dir);
  }
  return { kind: "path", path: `/${out.join("/")}` };
}

/** The URL a pages-router file serves; `index` is its folder's own URL. */
function pagesSegments(dirs: readonly string[], name: string): string {
  return `/${[...dirs, ...(name === "index" ? [] : [name])].join("/")}`;
}

interface Placement {
  role: RoleId | null;
  /** What Next.js serves from the file, when it serves anything. */
  serves: { kind: "page" | "handler"; segments: Segments } | null;
}

/** Where a file sits in a Next.js app, and what that makes it. Null outside app/, pages/ and the root files. */
function placeInApp(app: NextApp, file: string): Placement | null {
  const ext = path.posix.extname(file);
  const name = stem(file);
  const inside = (dir: string | null) => (dir !== null && file.startsWith(`${dir}/`) ? file.slice(dir.length + 1).split("/").slice(0, -1) : null);

  // Proxy (middleware before Next.js 16) and instrumentation sit beside app/.
  const root = app.dir === "." ? "" : `${app.dir}/`;
  const folder = path.posix.dirname(file);
  const atRoot = folder === (root === "" ? "." : app.dir) || folder === `${root}src`;
  if (atRoot && PAGE_EXTENSIONS.has(ext)) {
    if (name === "proxy" || name === "middleware") return { role: "proxy", serves: null };
    if (name === "instrumentation" || name === "instrumentation-client") return { role: "instrumentation", serves: null };
  }

  const appDirs = inside(app.appDir);
  if (appDirs && PAGE_EXTENSIONS.has(ext)) {
    const segments = appSegments(appDirs);
    if (segments.kind === "private") return null;
    if (name === "page") return { role: "page", serves: { kind: "page", segments } };
    if (name === "route") return { role: "api", serves: { kind: "handler", segments } };
    if (name === "layout" || name === "template") return { role: "layout", serves: null };
    if (ROUTE_UI.has(name)) return { role: "route-ui", serves: null };
    if (METADATA.test(name)) return { role: "metadata", serves: null };
    return null;
  }

  const pagesDirs = inside(app.pagesDir);
  if (pagesDirs && PAGE_EXTENSIONS.has(ext)) {
    // API routes branch on req.method at runtime, so they have no method to state.
    if (pagesDirs[0] === "api") return { role: "api", serves: null };
    if (pagesDirs.length === 0 && (name === "_app" || name === "_document")) return { role: "layout", serves: null };
    if (pagesDirs.length === 0 && (name === "_error" || name === "404" || name === "500")) return { role: "route-ui", serves: null };
    return { role: "page", serves: { kind: "page", segments: { kind: "path", path: pagesSegments(pagesDirs, name) } } };
  }
  return null;
}

function appRoutes(repo: RepoContext, app: NextApp): Route[] {
  if (!app.config.routable) return [];
  const mount = (urlPath: string) => (app.config.basePath === "" ? urlPath : urlPath === "/" ? app.config.basePath : `${app.config.basePath}${urlPath}`);
  const routes: Route[] = [];
  for (const f of repo.files) {
    if (f.module !== app.dir) continue;
    const served = placeInApp(app, f.path)?.serves;
    if (!served || served.segments.kind !== "path") continue;
    if (app.pagesDir !== null && f.path.startsWith(`${app.pagesDir}/`) && !app.config.pagesRoutable) continue;
    const urlPath = mount(served.segments.path);

    // A page answers GET by definition; that is what rendering it is.
    if (served.kind === "page") routes.push({ file: f.path, path: urlPath, kind: "page", methods: ["GET"], line: null });
    else {
      const methods = esmExports(repo.syntax(f.path));
      if (methods === null) continue; // `export *`: what it exports isn't in this file
      for (const { name, line } of methods) {
        if (HANDLER_METHODS.has(name)) routes.push({ file: f.path, path: urlPath, kind: "route_handler", methods: [name], line });
      }
    }
  }
  return routes;
}
