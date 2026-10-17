import { existsSync } from "node:fs";
import path from "node:path";
import { Worker, type WorkerOptions } from "node:worker_threads";
import { PipelineError } from "./errors";
import type { ParseOutput } from "./parse-here";

export type { ParseOutput } from "./parse-here";

/** Heap ceiling for one parse. A repository that needs more fails the run, not the server. */
const MAX_HEAP_MB = 2048;

/**
 * The worker's entry, loaded by Node itself from source, not by the bundler.
 * Turbopack can bundle a worker, but the loader it generates finds the chunk
 * through __dirname, which doesn't exist once `next dev` hot-reloads that
 * code: every edit to the parser broke parsing until the server restarted.
 * Node runs TypeScript by stripping types, so the worker and the parser need
 * no build step, behave the same under `next dev`, `next start` and the CLI,
 * and always run the parser as it is on disk.
 *
 * Resolved from the working directory, which is the project root for all
 * three. This is a local app: the source is where it runs.
 */
const WORKER_ENTRY = path.join(process.cwd(), "src", "pipeline", "parse-worker.ts");

/**
 * Parses `root` on a worker thread, so the server keeps answering requests
 * while a large repository is read. The result crosses back by structured
 * clone, which the parse result (plain data) survives intact.
 */
export function parseInWorker(root: string): Promise<ParseOutput> {
  if (!existsSync(WORKER_ENTRY)) {
    return Promise.reject(new Error(`the parse worker isn't at ${WORKER_ENTRY}; run the app from the project root`));
  }
  return new Promise((resolve, reject) => {
    const options: WorkerOptions = {
      workerData: { root },
      // Plain Node, whatever the parent was started with (tsx's loaders,
      // Next's flags). The parser's files have no "type" in package.json, so
      // Node detects them as ES modules and would warn once per file.
      execArgv: ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"],
      resourceLimits: { maxOldGenerationSizeMb: MAX_HEAP_MB },
    };
    // Not `new Worker(...)`: Turbopack resolves the path at compile time,
    // recognizes the syntax, and replaces it with its own loader (the one that
    // breaks under hot reload), turbopackIgnore or not. Reflect.construct
    // creates the same Worker without matching that pattern.
    const worker: Worker = Reflect.construct(Worker, [WORKER_ENTRY, options]);
    let settled = false;
    worker.once("message", (message: ParseOutput) => {
      settled = true;
      resolve(message);
    });
    worker.once("error", (error: Error & { code?: string }) => {
      settled = true;
      reject(
        error.code === "ERR_WORKER_OUT_OF_MEMORY"
          ? new PipelineError(`Parsing needed more than ${MAX_HEAP_MB / 1024} GB of memory; the repository is too large to map.`)
          : error,
      );
    });
    worker.once("exit", (code) => {
      if (!settled) reject(new Error(`the parser's worker stopped with exit code ${code} before returning a result`));
    });
  });
}
