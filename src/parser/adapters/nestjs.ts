import path from "node:path";
import { Node, type ClassDeclaration, type Decorator, type SourceFile } from "ts-morph";
import { FRAMEWORKS, type RoleId } from "../taxonomy.ts";
import type { Route } from "../types.ts";
import type { Adapter, RepoContext } from "./adapter.ts";
import { holdsShare, isConfigFile, isTestFile, packagesDeclaring } from "./conventions.ts";
import { packageEntryPoints } from "./none.ts";

/**
 * NestJS. Roles come from the file name's suffix, the convention the Nest CLI
 * generates (`users.controller.ts`). Routes come from decorators: the
 * controller's path and the method's, joined the way Nest joins them.
 */
export const nestjsAdapter: Adapter = {
  id: "nestjs",
  name: FRAMEWORKS.nestjs.name,
  detect: (repo) => holdsShare(repo, nestPackages(repo)),
  entryPoints: (repo) => repo.modules.flatMap((mod) => packageEntryPoints(repo, mod.dir)),
  roles: (repo) => {
    const packages = nestPackages(repo);
    return new Map(
      repo.files.map((f) => {
        if (isTestFile(f.path)) return [f.path, "test"];
        if (isConfigFile(f.path)) return [f.path, "config"];
        return [f.path, (packages.has(f.module) ? suffixRole(f.path) : undefined) ?? "other"];
      }),
    );
  },
  routes: (repo) => nestRoutes(repo),
};

const SUFFIX_ROLES: Record<string, RoleId> = {
  controller: "controller",
  resolver: "resolver",
  gateway: "gateway",
  service: "service",
  repository: "repository",
  entity: "entity",
  schema: "schema",
  dto: "dto",
  module: "module",
  guard: "guard",
  interceptor: "interceptor",
  pipe: "pipe",
  filter: "filter",
  middleware: "middleware",
  strategy: "strategy",
  decorator: "decorator",
};

/** `users.controller.ts` -> controller. A name with no suffix has no role. */
function suffixRole(file: string): RoleId | undefined {
  const parts = path.posix.basename(file).split(".");
  if (parts.length < 3) return undefined;
  const suffix = parts[parts.length - 2];
  return Object.hasOwn(SUFFIX_ROLES, suffix) ? SUFFIX_ROLES[suffix] : undefined;
}

function nestPackages(repo: RepoContext): Set<string> {
  return packagesDeclaring(repo, "@nestjs/core", ["dependencies", "peerDependencies"]);
}

/** HTTP method decorators from @nestjs/common, and the method each one maps. */
const METHOD_DECORATORS: Record<string, string> = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Delete: "DELETE",
  Patch: "PATCH",
  Options: "OPTIONS",
  Head: "HEAD",
  Search: "SEARCH",
  All: "ALL",
};

/** Controller options that don't change the path a route is served on. */
const PATH_NEUTRAL_OPTIONS = new Set(["path", "scope", "durable"]);

function nestRoutes(repo: RepoContext): Route[] {
  const packages = nestPackages(repo);
  const files = repo.files.filter((f) => packages.has(f.module));

  const prefix = globalPrefix(repo, files.map((f) => f.path));
  if (prefix === null) return [];

  const routes: Route[] = [];
  for (const f of files) {
    if (!repo.text(f.path).includes("@nestjs/common")) continue;
    const source = repo.syntax(f.path);
    const names = commonImports(source);
    if (names.size === 0) continue;
    for (const cls of source.getClasses()) routes.push(...controllerRoutes(f.path, cls, names, prefix));
  }
  return routes;
}

/**
 * The prefix every route is mounted under, from `app.setGlobalPrefix("api")`.
 * "" when nothing sets one. Null when routes can't be stated exactly: the
 * prefix is computed, excludes some routes, differs between calls, or URI
 * versioning or RouterModule put more in front of the path.
 */
function globalPrefix(repo: RepoContext, files: readonly string[]): string | null {
  const prefixes = new Set<string>();
  for (const file of files) {
    const text = repo.text(file);
    if (!text.includes("setGlobalPrefix") && !text.includes("enableVersioning") && !text.includes("RouterModule")) continue;
    const source = repo.syntax(file);
    for (const decl of source.getImportDeclarations()) {
      if (decl.getModuleSpecifierValue() === "@nestjs/core" && decl.getNamedImports().some((n) => n.getName() === "RouterModule")) return null;
    }
    let exact = true;
    source.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) return;
      const name = callee.getName();
      if (name === "enableVersioning") exact = false;
      if (name !== "setGlobalPrefix") return;
      const args = node.getArguments();
      const [arg] = args;
      if (args.length === 1 && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) prefixes.add(arg.getLiteralValue());
      else exact = false;
    });
    if (!exact) return null;
  }
  if (prefixes.size > 1) return null;
  return [...prefixes][0] ?? "";
}

/**
 * How this file refers to @nestjs/common's decorators: local name to exported
 * name, so `import { Get as Fetch }` still counts. A namespace import maps
 * `ns.` to "".
 */
function commonImports(source: SourceFile): Map<string, string> {
  const names = new Map<string, string>();
  for (const decl of source.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== "@nestjs/common" || decl.isTypeOnly()) continue;
    for (const named of decl.getNamedImports()) names.set(named.getAliasNode()?.getText() ?? named.getName(), named.getName());
    const namespace = decl.getNamespaceImport();
    if (namespace) names.set(`${namespace.getText()}.`, "");
  }
  return names;
}

/** The @nestjs/common export a decorator calls, or null if it calls something else. */
function decoratorName(decorator: Decorator, names: ReadonlyMap<string, string>): string | null {
  const expr = decorator.getExpression();
  if (!Node.isCallExpression(expr)) return null; // Nest's decorators are always called
  const callee = expr.getExpression();
  if (Node.isIdentifier(callee)) return names.get(callee.getText()) ?? null;
  if (Node.isPropertyAccessExpression(callee) && names.get(`${callee.getExpression().getText()}.`) === "") return callee.getName();
  return null;
}

/** A path argument as literal text: none means "", a string or an array of strings. Null for anything computed. */
function literalPaths(arg: Node | undefined): string[] | null {
  if (arg === undefined) return [""];
  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) return [arg.getLiteralValue()];
  if (Node.isArrayLiteralExpression(arg)) {
    const elements = arg.getElements();
    if (elements.length === 0) return null;
    const values: string[] = [];
    for (const el of elements) {
      if (!Node.isStringLiteral(el) && !Node.isNoSubstitutionTemplateLiteral(el)) return null;
      values.push(el.getLiteralValue());
    }
    return values;
  }
  return null;
}

/** What @Controller(...) mounts the class on, or null if it can't be stated exactly. */
function controllerPaths(arg: Node | undefined): string[] | null {
  if (arg === undefined || !Node.isObjectLiteralExpression(arg)) return literalPaths(arg);
  let paths: string[] = [""];
  for (const prop of arg.getProperties()) {
    // host and version change where a route answers; a spread could hide either.
    if (!Node.isPropertyAssignment(prop) || !PATH_NEUTRAL_OPTIONS.has(prop.getName())) return null;
    if (prop.getName() === "path") {
      const found = literalPaths(prop.getInitializer());
      if (found === null) return null;
      paths = found;
    }
  }
  return paths;
}

/** Nest's joining: one leading slash, no empty segments, no trailing slash. */
function joinPath(...parts: string[]): string {
  return `/${parts.flatMap((p) => p.split("/")).filter((s) => s !== "").join("/")}`;
}

function controllerRoutes(file: string, cls: ClassDeclaration, names: ReadonlyMap<string, string>, prefix: string): Route[] {
  const classDecorators = cls.getDecorators().map((d) => ({ d, name: decoratorName(d, names) }));
  const controller = classDecorators.find((c) => c.name === "Controller");
  if (!controller) return [];
  // @Version puts the version into the path under URI versioning; which kind
  // is configured elsewhere.
  if (classDecorators.some((c) => c.name === "Version")) return [];
  const bases = controllerPaths(controller.d.getArguments()[0]);
  if (bases === null) return [];

  const routes: Route[] = [];
  for (const method of cls.getMethods()) {
    const decorators = method.getDecorators().map((d) => ({ d, name: decoratorName(d, names) }));
    if (decorators.some((m) => m.name === "Version")) continue;
    for (const { d, name } of decorators) {
      if (name === null || !Object.hasOwn(METHOD_DECORATORS, name)) continue;
      const args = d.getArguments();
      const subPaths = literalPaths(args[0]);
      if (subPaths === null) continue;
      for (const base of bases) {
        for (const sub of subPaths) {
          routes.push({ file, path: joinPath(prefix, base, sub), kind: "api", methods: [METHOD_DECORATORS[name]], line: d.getStartLineNumber() });
        }
      }
    }
  }
  return routes;
}
