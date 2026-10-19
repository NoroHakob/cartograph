// Loads the app's environment into a script that runs outside the app.
//
//   node --env-file=.env.local scripts/<name>.mjs
//
// Next reads .env.local for the app, and Node's --env-file reads the same
// file for a script, so both see one set of variables. This module checks
// the file was actually passed, then makes the app's server code importable:
// TypeScript and the "@/" alias through tsx, and server-side module
// resolution through a resolve hook. Import it first, then import the
// TypeScript entry dynamically and hand it to run(), so the hooks are in
// place before it loads.

import { registerHooks } from "node:module";
import { register as registerTsxCjs } from "tsx/cjs/api";
import { register as registerTsx } from "tsx/esm/api";

/** Variables every script needs: their presence shows .env.local was read. */
const ALWAYS = ["NEXT_PUBLIC_SUPABASE_URL"];

/**
 * Stops the script with a clear message when a variable is missing or blank.
 * Run with `node --env-file=.env.local`, or the file is never read.
 */
export function requireEnv(...names) {
  const missing = [...ALWAYS, ...names].filter((name) => !process.env[name]?.trim());
  if (missing.length === 0) return;
  const unread = missing.includes(ALWAYS[0]);
  console.error(
    unread
      ? `error: .env.local wasn't loaded. Run scripts as:\n\n  node --env-file=.env.local ${relativeScript()}\n`
      : `error: missing in .env.local: ${missing.join(", ")}`,
  );
  process.exit(1);
}

function relativeScript() {
  const script = process.argv[1] ?? "scripts/<name>.mjs";
  const at = script.replaceAll("\\", "/").lastIndexOf("/scripts/");
  return at >= 0 ? script.replaceAll("\\", "/").slice(at + 1) : script;
}

// TypeScript, both loaders as the tsx CLI does: with no "type" in
// package.json, Node loads a .ts file as CommonJS.
registerTsxCjs();
registerTsx();

// Every import and require resolves under the "react-server" condition, as
// Next resolves server code: `server-only` becomes the empty module it is on
// the server, instead of the guard that throws in a browser bundle. The same
// as `pnpm analyze` gets from tsx --conditions=react-server.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const conditions = context.conditions?.includes("react-server") ? context.conditions : [...(context.conditions ?? []), "react-server"];
    return nextResolve(specifier, { ...context, conditions });
  },
});

/**
 * Runs the `main` exported by a script's TypeScript entry, setting the exit
 * code from what it returns or throws. Pass the import itself:
 * `run(import("../evals/x.ts"))`. Loaded as CommonJS, the entry's exports
 * arrive under `default`.
 */
export function run(entry) {
  Promise.resolve(entry)
    .then((loaded) => {
      const main = loaded.main ?? loaded.default?.main;
      if (typeof main !== "function") throw new Error("the script's entry doesn't export a main function");
      return main(process.argv.slice(2));
    })
    .then(
      (code) => (process.exitCode = code ?? 0),
      (error) => {
        console.error(error instanceof Error ? (error.stack ?? error.message) : error);
        process.exitCode = 1;
      },
    );
}
