import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { followedUp, hedges, plumbing } from "./checks";

describe("hedging", () => {
  test("finds guessing words in prose", () => {
    assert.deepEqual(hedges("Authentication is probably in `src/auth.ts`, and it might be used by the router. I think that's it."), [
      "probably",
      "might be",
      "i think",
    ]);
  });

  test("a straight answer, or words inside paths, aren't hedging", () => {
    assert.deepEqual(hedges("The map shows `src/middleware/basic-auth/index.ts`. Going by its name, it checks credentials in a header."), []);
    assert.deepEqual(hedges("See `src/likely/usually.ts` and src/perhaps.ts."), []);
  });
});

describe("plumbing", () => {
  test("tool names count anywhere, generic words only in prose", () => {
    assert.deepEqual(plumbing("I called `find_files` and the tool returned JSON."), ["find_files", "tool", "json"]);
    assert.deepEqual(plumbing("Routes are declared in `src/api/json.ts`."), []);
  });

  test("talking about the system prompt or a failed request is plumbing", () => {
    assert.deepEqual(plumbing("My instructions say I can't. The server returned an error."), ["my instructions", "the server returned"]);
  });

  test("ordinary words for the map's own ideas aren't", () => {
    assert.deepEqual(plumbing("Nothing in the map imports it, and the walk reaches 4 files that depend on it."), []);
  });
});

describe("follow-ups", () => {
  test("resolves to a path an earlier lookup returned", () => {
    const earlier = new Set(["src/auth.ts", "src/index.ts"]);
    assert.equal(followedUp([{ tool: "walk", args: { path: "src/auth.ts", direction: "dependents" }, ok: true }], earlier), "src/auth.ts");
    assert.equal(followedUp([{ tool: "walk", args: { path: "src/other.ts", direction: "dependents" }, ok: true }], earlier), null);
    assert.equal(followedUp([{ tool: "walk", args: { path: "src/auth.ts" }, ok: false }], earlier), null);
  });
});
