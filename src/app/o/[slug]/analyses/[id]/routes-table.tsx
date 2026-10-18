import type { FrameworkId } from "@/parser/taxonomy";
import type { RouteKind } from "@/parser/types";
import type { StoredRoute } from "./explorer-data";

/** Why the table is empty, when it is. */
const EMPTY: Record<FrameworkId, string> = {
  nextjs: "No route could be read exactly from the code. A route is listed only when both its method and its full path are.",
  nestjs: "No route could be read exactly from the code. A route is listed only when both its method and its full path are.",
  express:
    "Express builds its routes at runtime from routers, variables and middleware chains, so no route can be read exactly from the code. None are listed rather than guessed.",
  react: "React doesn't turn files into routes by itself, so there are none to list.",
  none: "Without a framework, nothing turns files into routes, so there are none to list.",
};

const KIND_LABELS: Record<RouteKind, string> = {
  page: "Page",
  layout: "Layout",
  route_handler: "Route handler",
  middleware: "Middleware",
  api: "Endpoint",
};

/**
 * Every route the parser extracted, one row per method and pattern. Each row
 * links to the line that declares it at the analysed commit, so any route can
 * be checked against the code by hand. Routes the parser couldn't state
 * exactly were never extracted, so they aren't here to show.
 */
export function RoutesTable({ routes, framework }: { routes: StoredRoute[]; framework: FrameworkId }) {
  return (
    <section aria-labelledby="routes-heading" className="mt-12">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="routes-heading" className="text-sm font-medium">
          Routes
        </h2>
        <span className="text-[13px] text-fg-muted tabular-nums">{routes.length.toLocaleString()}</span>
      </div>
      {routes.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">{EMPTY[framework]}</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-muted text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Method
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Path
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Declared in
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {routes.map((route) => (
                <tr key={`${route.file}:${route.line ?? 0}:${route.methods.join()}:${route.path}`} className="align-top">
                  <td className="px-3 py-2 font-mono text-xs font-semibold whitespace-nowrap">{route.methods.join(", ")}</td>
                  <td className="px-3 py-2 font-mono text-xs break-all">{route.path}</td>
                  <td className="px-3 py-2 text-xs">
                    <a
                      href={route.href}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono break-all text-fg-muted underline-offset-4 hover:text-fg hover:underline"
                    >
                      {route.file}
                      {route.line !== null && `:${route.line}`}
                    </a>
                    <span className="ml-2 whitespace-nowrap text-fg-muted">{KIND_LABELS[route.kind]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
