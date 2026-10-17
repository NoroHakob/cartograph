// The rail's taxonomy: which roles a file can have, what each is called, and
// the order a framework lists them in. Plain data with no imports, so a
// browser component can read category names without pulling the parser, its
// adapters, ts-morph or the filesystem into the bundle. The adapters assign
// these roles; this file only names and orders them.

export type FrameworkId = "nextjs" | "nestjs" | "react" | "none";

export type RoleId =
  // Next.js
  | "page"
  | "api"
  | "server-action"
  | "layout"
  | "route-ui"
  | "client-component"
  | "metadata"
  | "proxy"
  | "instrumentation"
  // React, and Next.js
  | "component"
  | "hook"
  // NestJS
  | "controller"
  | "resolver"
  | "gateway"
  | "service"
  | "repository"
  | "entity"
  | "schema"
  | "dto"
  | "module"
  | "guard"
  | "interceptor"
  | "pipe"
  | "filter"
  | "middleware"
  | "strategy"
  | "decorator"
  // Any framework
  | "entry"
  | "source"
  | "config"
  | "test"
  | "other";

export interface RoleInfo {
  /** What the rail shows: the concrete role, plural, e.g. "Controllers". */
  name: string;
  /** Mid-tone colours that read on both the light and the dark surface. */
  color: string;
}

export const ROLES: Record<RoleId, RoleInfo> = {
  page: { name: "Page routes", color: "#3b82c4" },
  api: { name: "API endpoints", color: "#16a3a8" },
  "server-action": { name: "Server actions", color: "#d0a12a" },
  layout: { name: "Layouts", color: "#9b6ad6" },
  "route-ui": { name: "Loading & error UI", color: "#c4577a" },
  "client-component": { name: "Client components", color: "#e07a3a" },
  metadata: { name: "Metadata files", color: "#b5664f" },
  proxy: { name: "Proxy & middleware", color: "#5b6fe0" },
  instrumentation: { name: "Instrumentation", color: "#2f8f8a" },

  component: { name: "Components", color: "#5a9e4b" },
  hook: { name: "Hooks", color: "#d06a9e" },

  controller: { name: "Controllers", color: "#3b82c4" },
  resolver: { name: "Resolvers", color: "#16a3a8" },
  gateway: { name: "Gateways", color: "#2f8f8a" },
  service: { name: "Services", color: "#d0a12a" },
  repository: { name: "Repositories", color: "#e07a3a" },
  entity: { name: "Entities", color: "#9b6ad6" },
  schema: { name: "Schemas", color: "#c4577a" },
  dto: { name: "DTOs", color: "#5a9e4b" },
  module: { name: "Modules", color: "#5b6fe0" },
  guard: { name: "Guards", color: "#b5664f" },
  interceptor: { name: "Interceptors", color: "#d06a9e" },
  pipe: { name: "Pipes", color: "#7a7fc4" },
  filter: { name: "Filters", color: "#a3794a" },
  middleware: { name: "Middleware", color: "#4f8bb5" },
  strategy: { name: "Strategies", color: "#6f9a2a" },
  decorator: { name: "Decorators", color: "#c48a3b" },

  entry: { name: "Entry points", color: "#e07a3a" },
  source: { name: "Source files", color: "#3b82c4" },
  config: { name: "Config", color: "#a39a8a" },
  test: { name: "Tests", color: "#8b93a1" },
  other: { name: "Other files", color: "#6b7280" },
};

export interface Framework {
  /** What the analysis says it is, e.g. "Next.js". */
  name: string;
  /**
   * Every role this framework's adapter can assign, in reading order:
   * routable surfaces first, then the layers behind them, then plumbing. The
   * order is fixed, never sorted by count, so a repository's categories are
   * always in the same places.
   */
  roles: readonly RoleId[];
}

export const FRAMEWORKS: Record<FrameworkId, Framework> = {
  nextjs: {
    name: "Next.js",
    roles: [
      "page",
      "api",
      "server-action",
      "layout",
      "route-ui",
      "client-component",
      "component",
      "hook",
      "metadata",
      "proxy",
      "instrumentation",
      "config",
      "test",
      "other",
    ],
  },
  nestjs: {
    name: "NestJS",
    roles: [
      "controller",
      "resolver",
      "gateway",
      "service",
      "repository",
      "entity",
      "schema",
      "dto",
      "module",
      "guard",
      "interceptor",
      "pipe",
      "filter",
      "middleware",
      "strategy",
      "decorator",
      "config",
      "test",
      "other",
    ],
  },
  react: {
    name: "React",
    roles: ["entry", "component", "hook", "config", "test", "other"],
  },
  none: {
    name: "No framework",
    roles: ["entry", "source", "config", "test"],
  },
};

export function isFrameworkId(value: unknown): value is FrameworkId {
  return typeof value === "string" && Object.hasOwn(FRAMEWORKS, value);
}

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === "string" && Object.hasOwn(ROLES, value);
}
