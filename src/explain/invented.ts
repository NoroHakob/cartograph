// The invented-path check. Every path-shaped token in an answer is tested
// against the exact set of paths the model was shown; anything else was
// invented. Set membership, deterministic, no model involved: a detector for
// made-up paths that could itself make things up would measure nothing.
//
// The same function runs in three places: the pane, which shows invented
// paths unlinked; every live Explain run, as feedback on its trace; and the
// prompt experiments, as an evaluator. Plain data in, plain data out: safe to
// import from the browser and from scripts.

/** The feedback key the check is recorded under, live and in experiments. 1 is clean. */
export const INVENTED_PATHS_KEY = "no_invented_paths";

/** Extensions that make a token a file path even without a known folder in front. */
const FILE_EXT = /\.(?:[cm]?[jt]sx?|json|mdx?|s?css|less|html?|vue|svelte|ya?ml|toml|sql|graphql|gql|prisma)$/i;

/** One segment of a repository path: Next.js brackets and route groups included. */
const SEGMENT = /^[\w@.()[\]+~$-]+$/;

/** Where tokens split: whitespace, quotes and list punctuation never occur in a repository path here. */
const SPLIT = /[\s"'“”‘’,;<>|]+/;

/** Inline code: a run of backticks, its contents, the same run again. */
const CODE_SPAN = /(`+)([\s\S]*?[^`])\1(?!`)/g;

/**
 * Paths named in `text` that aren't among `shown`, as written, sorted and
 * without duplicates. A folder counts as shown when a path inside it was: the model
 * read "src/lib/db.ts", so "src/lib" is in front of it, not made up.
 */
export function inventedPaths(text: string, shown: Iterable<string>): string[] {
  const known = new Set<string>();
  const roots = new Set<string>();
  for (const path of shown) {
    const parts = normalise(path).split("/");
    if (parts.length > 1) roots.add(parts[0]);
    for (let i = 1; i <= parts.length; i++) known.add(parts.slice(0, i).join("/"));
  }

  const invented = new Set<string>();
  for (const { token, inCode } of tokens(text)) {
    const written = token.replace(/(?<=.)\/+$/, "");
    if (!pathShaped(written, inCode, roots)) continue;
    if (!known.has(normalise(written))) invented.add(written);
  }
  return [...invented].sort();
}

/** Every token, and whether it was written as inline code. */
function* tokens(text: string): Generator<{ token: string; inCode: boolean }> {
  let last = 0;
  const prose: string[] = [];
  for (const match of text.matchAll(CODE_SPAN)) {
    prose.push(text.slice(last, match.index));
    for (const token of match[2].split(SPLIT)) yield { token: trim(token), inCode: true };
    last = match.index + match[0].length;
  }
  prose.push(text.slice(last));
  // Bold markers are formatting the prompt allows, never part of a path.
  for (const part of prose) for (const token of part.replaceAll("**", " ").split(SPLIT)) yield { token: trim(token), inCode: false };
}

/**
 * Sentence punctuation around a token, and brackets that aren't balanced
 * inside it: "(see src/a.ts)." gives "src/a.ts", "app/(shop)/page.tsx" stays whole.
 */
function trim(token: string): string {
  let t = token;
  for (;;) {
    const before = t;
    t = t.replace(/^\*+|[*:!?.]+$/g, "");
    for (const [open, close] of ["()", "[]", "{}"]) {
      if (t.startsWith(open) && count(t, open) > count(t, close)) t = t.slice(1);
      if (t.endsWith(close) && count(t, close) > count(t, open)) t = t.slice(0, -1);
    }
    if (t === before) return t;
  }
}

const count = (text: string, char: string) => text.split(char).length - 1;

/** How the parser writes a path: no leading "./", no trailing slash. */
function normalise(path: string): string {
  return path.replace(/^\.\/(?=.)/, "").replace(/\/+$/, "");
}

/**
 * Whether a token names a repository path. A slash alone isn't enough
 * ("and/or", "read/write"): it must also end in a file extension, start
 * relative ("../lib"), or start with a top-level folder the model was shown.
 * A bare file name counts only as inline code ("`db.ts`", not "Node.js").
 */
function pathShaped(token: string, inCode: boolean, roots: ReadonlySet<string>): boolean {
  if (!token || token.includes("://") || /^\w+:/.test(token)) return false;
  const parts = token.split("/");
  const relative = parts[0] === "." || parts[0] === "..";
  if (!parts.every((p, i) => SEGMENT.test(p) || (relative && i === 0) || (p === ".." && i > 0))) return false;
  if (parts.length === 1) return inCode && FILE_EXT.test(token) && !/^\.?\d/.test(token);
  // A scoped package ("@hono/node-server") is a dependency, not a path in the repository.
  if (token.startsWith("@") && !roots.has(parts[0])) return false;
  return FILE_EXT.test(token) || relative || roots.has(parts[0]);
}
