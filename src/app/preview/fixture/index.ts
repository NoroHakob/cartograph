import "server-only";
import path from "node:path";
import { readParseResult } from "@/parser/output";
import type { ParseResult } from "@/parser/types";

// Scaffolding. hono.parse.json is the parser's untouched output for
// github.com/honojs/hono at 08807ce12aa3aa27c8c5adf63e677bbab6bceda9
// (`pnpm parse <clone> --out ...`). It exists so the map can be built without
// an account, a database or a network, and goes away once analyses are stored.

export const FIXTURE_REPOSITORY = "honojs/hono";

export function loadFixture(): ParseResult {
  // readParseResult checks the version and every invariant before returning.
  return readParseResult(path.join(process.cwd(), "src/app/preview/fixture/hono.parse.json"));
}
