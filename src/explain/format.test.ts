import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseExplanation, parseInline, pathMatcher, type Block, type Inline } from "./format";

/** Everything that would reach the screen as characters. */
const visible = (blocks: Block[]): string => {
  const inline = (parts: Inline[]): string => parts.map((p) => (p.kind === "bold" ? inline(p.children) : p.text)).join("");
  return blocks.map((b) => (b.kind === "paragraph" ? inline(b.inlines) : b.items.map(inline).join("\n"))).join("\n\n");
};

describe("the permitted subset", () => {
  test("inline code, bold and bullets become structure", () => {
    assert.deepEqual(parseInline("Reads `src/db.ts` and **writes** it."), [
      { kind: "text", text: "Reads " },
      { kind: "code", text: "src/db.ts" },
      { kind: "text", text: " and " },
      { kind: "bold", children: [{ kind: "text", text: "writes" }] },
      { kind: "text", text: " it." },
    ]);
    assert.deepEqual(parseExplanation("Intro line\nstill intro.\n\n- one\n- two\n  continued\n\nAfter."), [
      { kind: "paragraph", inlines: [{ kind: "text", text: "Intro line still intro." }] },
      { kind: "list", items: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two continued" }]] },
      { kind: "paragraph", inlines: [{ kind: "text", text: "After." }] },
    ]);
  });

  test("asterisk and numbered bullets are bullets too", () => {
    const [list] = parseExplanation("* a\n1. b\n2) c");
    assert.equal(list.kind, "list");
    assert.equal(list.kind === "list" && list.items.length, 3);
  });

  test("double-backtick code keeps a backtick inside it", () => {
    assert.deepEqual(parseInline("``a`b``"), [{ kind: "code", text: "a`b" }]);
  });
});

describe("markup outside the subset leaves no characters behind", () => {
  const noisy = [
    "## What it does",
    "",
    "This *italic* and _also italic_ file is **bold with `code`** inside.",
    "An unmatched ` backtick and a stray ** pair, and a [link](https://x.y).",
    "",
    "```ts",
    "const x = 1;",
    "```",
    "",
    "---",
    "> quoted **text**",
    "### Closing ###",
  ].join("\n");

  test("no backticks, asterisks or heading hashes are visible", () => {
    const shown = visible(parseExplanation(noisy));
    assert.doesNotMatch(shown, /[`*]/);
    assert.doesNotMatch(shown, /(^|\n)\s*#/);
    assert.match(shown, /What it does/);
    assert.match(shown, /italic and also italic file/);
    assert.match(shown, /const x = 1;/);
    assert.match(shown, /link\./);
    assert.match(shown, /Closing/);
  });

  test("a heading is an ordinary paragraph, never a label", () => {
    const [first] = parseExplanation("# Title\nBody");
    assert.deepEqual(first, { kind: "paragraph", inlines: [{ kind: "text", text: "Title" }] });
  });

  test("snake_case and multiplication survive", () => {
    assert.equal(visible(parseExplanation("calls load_user_data")), "calls load_user_data");
  });
});

describe("paths in prose", () => {
  const match = pathMatcher(["src/a.ts", "src/a", "src/lib/db.ts", "app/[slug]/page.tsx"]);

  test("names a known path, longest first", () => {
    assert.deepEqual(match("see src/a.ts and src/a."), [
      { kind: "text", text: "see " },
      { kind: "path", text: "src/a.ts", path: "src/a.ts" },
      { kind: "text", text: " and " },
      { kind: "path", text: "src/a", path: "src/a" },
      { kind: "text", text: "." },
    ]);
  });

  test("never a partial path", () => {
    assert.deepEqual(match("src/ab and src/a.tsx and lib/src/a.ts and src/a/b.ts"), [
      { kind: "text", text: "src/ab and src/a.tsx and lib/src/a.ts and src/a/b.ts" },
    ]);
  });

  test("brackets in paths are literal", () => {
    assert.deepEqual(match("(app/[slug]/page.tsx)").map((s) => s.kind), ["text", "path", "text"]);
  });
});
