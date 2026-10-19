import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { assertEnv } from "./src/env/required";

// Next has loaded .env* by the time this file runs, so this crashes on boot
// when configuration is missing.
assertEnv();

/**
 * Every installed package `names` need at runtime, as globs from the project
 * root. Follows `dependencies` the way Node resolves them: the nearest
 * node_modules/<name> walking up from the package that asks.
 */
function packageClosure(names: string[]): string[] {
  const root = process.cwd();
  const seen = new Set<string>();
  const visit = (name: string, from: string) => {
    for (let dir = from; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, "node_modules", name);
      if (existsSync(path.join(candidate, "package.json"))) {
        if (seen.has(candidate)) return;
        seen.add(candidate);
        const manifest = JSON.parse(readFileSync(path.join(candidate, "package.json"), "utf8")) as {
          dependencies?: Record<string, string>;
        };
        for (const dep of Object.keys(manifest.dependencies ?? {})) visit(dep, candidate);
        return;
      }
      if (dir === root || path.dirname(dir) === dir) throw new Error(`next.config: can't find the package ${name}`);
    }
  };
  for (const name of names) visit(name, root);
  return [...seen].map((dir) => `./${path.relative(root, dir).replace(/\\/g, "/")}/**/*`);
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The parse worker runs from source, outside the bundle (see
  // src/pipeline/parse.ts), so the build's tracer sees its entry but none of
  // what it imports. Ship the pipeline and parser source and the packages
  // they load with the routes whose actions start an analysis.
  outputFileTracingIncludes: {
    "/o/**": ["./src/pipeline/**/*.ts", "./src/parser/**/*.ts", ...packageClosure(["ts-morph", "ignore"])],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
