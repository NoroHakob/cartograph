// Runs inside the parse worker, which Node loads straight from source (see
// ./parse.ts). Everything this file imports, directly or through the parser,
// must be plain Node-loadable TypeScript: relative imports with an explicit
// .ts extension, no "@/" aliases, nothing that needs more than type stripping.

import { parseRepository } from "../parser/index.ts";
import { checkInvariants } from "../parser/output.ts";
import type { ParseResult } from "../parser/types.ts";

export interface ParseOutput {
  result: ParseResult;
  /** Broken invariants; empty when the result is sound. */
  problems: string[];
}

/** Parses `root` on the calling thread, blocking it until done. */
export function parseHere(root: string): ParseOutput {
  const result = parseRepository(root);
  return { result, problems: checkInvariants(result) };
}
