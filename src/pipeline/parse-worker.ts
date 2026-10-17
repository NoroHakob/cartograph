// The parse worker's entry point. Node runs it straight from source in a
// worker thread (see ./parse.ts); the parser is synchronous and CPU-bound, and
// here it holds this thread's event loop instead of the server's.

import { parentPort, workerData } from "node:worker_threads";
import { parseHere } from "./parse-here.ts";

const { root } = workerData as { root: string };
parentPort!.postMessage(parseHere(root));
