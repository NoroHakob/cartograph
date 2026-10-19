"use client";

import { Fragment, useMemo, useState, useTransition, type ReactNode } from "react";
import { parseExplanation, pathMatcher, type Inline, type PathMatcher } from "@/explain/format";
import type { Explanation, Staleness } from "@/explain/types";
import { nodeId } from "@/map/view";
import { ROLES } from "@/parser/taxonomy";
import type { Hover } from "./dependency-map";

/** What the pane holds for one file or folder. Kept above the pane, so it outlives the selection. */
export type ExplainState =
  | { status: "loading"; previous?: Explanation }
  | { status: "done"; explanation: Explanation }
  | { status: "error"; message: string; previous?: Explanation };

/** How a path in the prose moves the map. */
export interface PathLinks {
  files: ReadonlySet<string>;
  /** Folded folders: the map's nodes. */
  folders: ReadonlySet<string>;
  onFile: (path: string) => void;
  onFolder: (dir: string) => void;
  onHover: (hover: Hover | null) => void;
}

interface ExplanationPanelProps {
  noun: "file" | "folder";
  state: ExplainState | undefined;
  /** Absent where nothing can be explained, such as the offline preview. */
  onExplain?: () => void;
  onReanalyse?: () => Promise<{ error: string }>;
  links: PathLinks;
}

export function ExplanationPanel({ noun, state, onExplain, onReanalyse, links }: ExplanationPanelProps) {
  const shown = state?.status === "done" ? state.explanation : state?.previous;
  const loading = state?.status === "loading";

  if (!onExplain) {
    return (
      <Empty title="No explanation here">Explanations are written for stored analyses. This preview has no server to ask.</Empty>
    );
  }

  if (!shown) {
    return (
      <div className="px-4 py-6">
        <p className="text-sm text-fg-muted">
          {noun === "file"
            ? "What this file does, written from its source and every file it imports or is imported by."
            : "What lives in this folder, and why the rest of the repository points at it."}
        </p>
        <ExplainButton onClick={onExplain} loading={loading} />
        {state?.status === "error" && <p className="mt-3 text-sm text-danger">{state.message}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <StaleNotice staleness={shown.staleness} analysedCommit={shown.analysedCommit} noun={noun} onReanalyse={onReanalyse} />
      <div className={`px-4 py-3 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
        <Body explanation={shown} links={links} />
      </div>
      {shown.role && (
        <p className="border-t border-border px-4 py-3 text-xs text-fg-muted">
          No convention identified this file, so the model labelled it{" "}
          <span className="font-medium text-fg">{ROLES[shown.role.role].name}</span>
          {shown.role.rationale ? `: ${shown.role.rationale}` : "."}
        </p>
      )}
      {shown.inventedPaths.length > 0 && (
        <p className="border-t border-border px-4 py-3 text-xs text-fg-muted">
          It also named {shown.inventedPaths.length === 1 ? "a path" : "paths"} the parser didn&apos;t hand it, which{" "}
          {shown.inventedPaths.length === 1 ? "isn't" : "aren't"} linked: <span className="font-mono"><SlashBreaks text={shown.inventedPaths.join(", ")} /></span>
        </p>
      )}
      <footer className="flex flex-col gap-1.5 border-t border-border px-4 py-3 text-[11px] text-fg-muted">
        <p>
          <span className="font-mono">{shown.model}</span> · {shown.cached ? "from the cache, no model call" : "written just now"}
        </p>
        <p className={shown.tracing.enabled ? undefined : "text-danger"}>
          {shown.tracing.enabled
            ? `Traced in LangSmith, project ${shown.tracing.project}`
            : `Not traced: ${shown.tracing.reason}. The answer is real, but no run was recorded.`}
        </p>
        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={onExplain}
            disabled={loading}
            className="rounded border border-border px-2 py-1 text-xs text-fg hover:border-fg-muted hover:bg-surface-muted disabled:opacity-60"
          >
            {loading ? "Explaining…" : "Explain again"}
          </button>
          {state?.status === "error" && <span className="text-danger">{state.message}</span>}
        </div>
      </footer>
    </div>
  );
}

function ExplainButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-60"
    >
      {loading ? "Explaining…" : "Explain"}
    </button>
  );
}

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-fg-muted">{children}</p>
    </div>
  );
}

const short = (sha: string) => sha.slice(0, 7);

function StaleNotice({
  staleness,
  analysedCommit,
  noun,
  onReanalyse,
}: {
  staleness: Staleness;
  analysedCommit: string;
  noun: "file" | "folder";
  onReanalyse?: () => Promise<{ error: string }>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (staleness.status === "current") return null;
  if (staleness.status === "unknown") {
    return <p className="border-b border-border px-4 py-2 text-[11px] text-fg-muted">Couldn&apos;t check this is still current: {staleness.reason}</p>;
  }

  const analysed = <span className="font-mono">{short(analysedCommit)}</span>;
  const head = <span className="font-mono">{short(staleness.head)}</span>;
  const message =
    staleness.status === "changed" ? (
      <>
        This explanation is stale. The file has changed since {analysed}, the commit that was analysed; the branch is now at {head}.
      </>
    ) : staleness.status === "removed" ? (
      <>
        This explanation is stale. The file no longer exists at {head}; it was analysed at {analysed}.
      </>
    ) : staleness.fileUnchanged ? (
      <>
        The repository has moved past {analysed} to {head}. This file is unchanged, but files around it may not be.
      </>
    ) : (
      <>
        The repository has moved past {analysed} to {head}, so this {noun} may have changed.
      </>
    );
  const stale = staleness.status === "changed" || staleness.status === "removed";

  return (
    <div className={`border-b border-border px-4 py-3 ${stale ? "border-l-2 border-l-danger" : ""}`}>
      <p className={`text-xs ${stale ? "text-fg" : "text-fg-muted"}`}>{message}</p>
      {onReanalyse && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              // Navigates to the analysis on success; only a refusal comes back.
              const result = await onReanalyse();
              setError(result.error);
            })
          }
          className="mt-2 rounded border border-border px-2 py-1 text-xs hover:border-fg-muted hover:bg-surface-muted disabled:opacity-60"
        >
          {pending ? "Starting…" : "Re-analyse"}
        </button>
      )}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

/** The three permitted constructs, with every handed path that's on the map turned into a link. */
function Body({ explanation, links }: { explanation: Explanation; links: PathLinks }) {
  const blocks = useMemo(() => parseExplanation(explanation.body), [explanation.body]);
  // Only paths the model was handed, and only those the map can move to.
  const match = useMemo(
    () => pathMatcher(explanation.paths.filter((p) => links.files.has(p) || links.folders.has(p))),
    [explanation.paths, links.files, links.folders],
  );
  return (
    <div className="flex flex-col gap-2.5 text-sm leading-6">
      {blocks.map((block, i) =>
        block.kind === "paragraph" ? (
          <p key={i}>
            <Inlines parts={block.inlines} match={match} links={links} />
          </p>
        ) : (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-5 marker:text-fg-muted">
            {block.items.map((item, j) => (
              <li key={j}>
                <Inlines parts={item} match={match} links={links} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function Inlines({ parts, match, links }: { parts: readonly Inline[]; match: PathMatcher; links: PathLinks }) {
  return parts.map((part, i) => {
    if (part.kind === "bold") {
      return (
        <strong key={i} className="font-semibold">
          <Inlines parts={part.children} match={match} links={links} />
        </strong>
      );
    }
    const code = part.kind === "code";
    const segments = match(part.text).map((segment, j) =>
      segment.kind === "text" ? (
        <SlashBreaks key={j} text={segment.text} />
      ) : (
        <PathLink key={j} path={segment.path} code={code} links={links}>
          <SlashBreaks text={segment.text} />
        </PathLink>
      ),
    );
    // Code without a slash is an identifier: it never wraps. Code with one is
    // a path, which may wrap only after a slash, never inside a name.
    return code ? (
      <code
        key={i}
        className={`rounded bg-surface-muted px-1 py-px font-mono text-[12px] ${part.text.includes("/") ? "" : "whitespace-nowrap"}`}
      >
        {segments}
      </code>
    ) : (
      <span key={i}>{segments}</span>
    );
  });
}

/** Text with a line-break opportunity after each slash, and nowhere else inside a word. */
function SlashBreaks({ text }: { text: string }) {
  const parts = text.split("/");
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <>
          /<wbr />
        </>
      )}
    </Fragment>
  ));
}

function PathLink({ path, code, links, children }: { path: string; code: boolean; links: PathLinks; children: ReactNode }) {
  const isFile = links.files.has(path);
  const hover: Hover = isFile ? { kind: "file", path } : { kind: "node", id: nodeId(path) };
  // An anchor rather than a button: a button lays out as one box, so a long
  // path would drop to its own line instead of wrapping with the sentence.
  return (
    <a
      href={`#${path}`}
      onClick={(event) => {
        event.preventDefault();
        if (isFile) links.onFile(path);
        else links.onFolder(path);
      }}
      onMouseEnter={() => links.onHover(hover)}
      onMouseLeave={() => links.onHover(null)}
      title={isFile ? `Show ${path} on the map` : `Show the ${path} folder on the map`}
      className={`text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent ${code ? "font-mono" : ""}`}
    >
      {children}
    </a>
  );
}
