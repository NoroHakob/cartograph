// The formatting an explanation may use, and what happens to the rest.
//
// The prompt permits exactly three things: inline code, bullets and bold.
// Those are parsed into structure here and rendered by the pane. Anything
// else a model sends anyway (headings, italics, links, fences, rules) loses
// its markup and keeps its words, so no backtick, asterisk or heading hash
// ever reaches the screen as a character. Plain data in, plain data out:
// safe to import from the browser.

export type Inline = { kind: "text"; text: string } | { kind: "code"; text: string } | { kind: "bold"; children: Inline[] };

export type Block = { kind: "paragraph"; inlines: Inline[] } | { kind: "list"; items: Inline[][] };

const BULLET = /^\s*(?:[-*+•]|\d{1,3}[.)])\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?/;

export function parseExplanation(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", inlines: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list && list.length > 0) blocks.push({ kind: "list", items: list.map(parseInline) });
    list = null;
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    // Fences and rules carry nothing but markup. A fenced block's lines are
    // kept as ordinary text.
    if (FENCE.test(raw) || RULE.test(raw)) continue;
    const line = raw.replace(QUOTE, "");
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      (list ??= []).push(bullet[1]);
      continue;
    }
    // A heading becomes an ordinary paragraph: the pane is narrow, and
    // headings cut a few short paragraphs into labelled fragments.
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      paragraph.push(heading[1]);
      flushParagraph();
      continue;
    }
    // An indented line under a bullet continues it; anything else ends the list.
    if (list && /^\s+/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Inline code, then bold, then whatever is left as text with its markup removed. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let rest = source;
  while (rest.length > 0) {
    const tick = rest.indexOf("`");
    if (tick < 0) break;
    const run = /^`+/.exec(rest.slice(tick))![0];
    const close = rest.indexOf(run, tick + run.length);
    if (close < 0) {
      // An unmatched backtick is markup that went wrong, not content.
      pushText(out, rest.slice(0, tick + run.length).replaceAll("`", ""), true);
      rest = rest.slice(tick + run.length);
      continue;
    }
    pushText(out, rest.slice(0, tick), true);
    const code = rest.slice(tick + run.length, close).trim();
    if (code) out.push({ kind: "code", text: code });
    rest = rest.slice(close + run.length);
  }
  pushText(out, rest, true);
  return out;
}

const BOLD = /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/g;

function pushText(out: Inline[], text: string, allowBold: boolean) {
  if (!text) return;
  if (allowBold) {
    let last = 0;
    for (const match of text.matchAll(BOLD)) {
      pushText(out, text.slice(last, match.index), false);
      const inner: Inline[] = [];
      pushText(inner, match[1] ?? match[2], false);
      if (inner.length > 0) out.push({ kind: "bold", children: inner });
      last = match.index + match[0].length;
    }
    text = text.slice(last);
  }
  const plain = stripMarkup(text);
  if (!plain) return;
  const previous = out[out.length - 1];
  if (previous?.kind === "text") previous.text += plain;
  else out.push({ kind: "text", text: plain });
}

/** Links keep their words, italics and stray markers go. */
function stripMarkup(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
    .replace(/[*`]/g, "");
}

/** A run of text, split where it names a repository path. */
export type Segment = { kind: "text"; text: string } | { kind: "path"; text: string; path: string };

export type PathMatcher = (text: string) => Segment[];

/**
 * Finds the given paths in prose. Longest first, so "src/a.ts" wins over a
 * folder "src/a"; and only whole paths, so "src/a" is never matched inside
 * "src/a.ts" or "src/ab". A trailing full stop ends a path.
 */
export function pathMatcher(paths: Iterable<string>): PathMatcher {
  const sorted = [...new Set(paths)].filter((p) => p.length > 0 && p !== ".").sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return (text) => [{ kind: "text", text }];
  const escaped = sorted.map((p) => p.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"));
  const pattern = new RegExp(`(?<![\\w./@-])(?:${escaped.join("|")})(?![\\w/-])(?!\\.[\\w/])`, "g");
  return (text) => {
    const out: Segment[] = [];
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > last) out.push({ kind: "text", text: text.slice(last, match.index) });
      out.push({ kind: "path", text: match[0], path: match[0] });
      last = match.index + match[0].length;
    }
    if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
    return out;
  };
}

const PATH_LIKE = /(?<![\w./@-])(?:[\w@.()[\]+-]+\/)+[\w@.()[\]+-]+\.[cm]?[jt]sx?(?![\w/])/g;

/**
 * Source-file paths the text names that aren't among `known`. An answer
 * should name only what it was handed; these are the ones it didn't.
 */
export function unknownPaths(text: string, known: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PATH_LIKE)) if (!known.has(match[0])) found.add(match[0]);
  return [...found].sort();
}
