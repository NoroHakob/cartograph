import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { inventedPaths } from "./invented";

const shown = ["src/lib/db.ts", "src/users/service.ts", "app/(shop)/[slug]/page.tsx", "index.ts", "packages/core/src"];
const check = (text: string) => inventedPaths(text, shown);

describe("paths the model was shown", () => {
  test("pass, however they're punctuated or formatted", () => {
    assert.deepEqual(check("It reads `src/lib/db.ts`, and **src/users/service.ts** calls it (see src/lib/db.ts)."), []);
    assert.deepEqual(check("Rendered by app/(shop)/[slug]/page.tsx: the product page."), []);
    assert.deepEqual(check("The root `index.ts` re-exports it."), []);
  });

  test("their folders count as shown", () => {
    assert.deepEqual(check("Everything in src/lib/ and `src/users` depends on it, as does packages/core."), []);
  });
});

describe("paths it wasn't shown", () => {
  test("are reported as written, once each, sorted", () => {
    assert.deepEqual(check("It calls src/lib/cache.ts and src/lib/cache.ts again, then `src/made/up.tsx`."), ["src/lib/cache.ts", "src/made/up.tsx"]);
  });

  test("a shortened or relative path is not the path it was shown", () => {
    assert.deepEqual(check("Imported as `./db` from `db.ts` and ../users/service.ts."), ["../users/service.ts", "./db", "db.ts"]);
  });

  test("a path under a folder it was shown is still a path it wasn't", () => {
    assert.deepEqual(check("See src/lib/http and packages/core/src/index"), ["packages/core/src/index", "src/lib/http"]);
  });

  test("a file extension makes any slashed token a path", () => {
    assert.deepEqual(check("Compare lib/other/thing.js."), ["lib/other/thing.js"]);
  });
});

describe("things that aren't paths", () => {
  test("prose with slashes, packages, URLs and library names", () => {
    const prose = [
      "It handles read/write and input/output, 1/2 of the time.",
      "It wraps @hono/node-server and react-dom/client, see https://example.com/a/b.ts.",
      "Built on Node.js and Next.js, using node:fs.",
      "**Bold** text and a code span `useState` and `export const x = 1`.",
    ].join("\n");
    assert.deepEqual(check(prose), []);
  });

  test("an unbalanced bracket is punctuation, a balanced one is the path's", () => {
    assert.deepEqual(check("(app/(shop)/[slug]/page.tsx)"), []);
    assert.deepEqual(check("[src/lib/db.ts]"), []);
  });
});
