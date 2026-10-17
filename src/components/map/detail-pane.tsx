"use client";

import { useMemo, useState, type ReactNode } from "react";
import { roleColor } from "@/map/categories";
import { ROLES } from "@/parser/taxonomy";
import {
  CONVENTION_LABELS,
  conventions,
  folderSummary,
  LANGUAGE_NAMES,
  neighbourIndex,
  repoSummary,
  type DetailFile,
  type RepoFacts,
} from "@/map/detail";
import {
  graphIndex,
  INSIGHT_ORDER,
  INSIGHT_SENTENCES,
  insights,
  reach,
  REACH_DEPTH,
  type Direction,
  type GraphIndex,
  type InsightKind,
  type Insights,
} from "@/map/graph";
import { nodeId, type MapEdge } from "@/map/view";
import type { MapController } from "./dependency-map";

export type DetailTab = "structure" | "explanation";

/** Which walk the file view is showing: the blast radius or the dependency chain. */
export type ReachMode = Direction;

const REACH_LABELS: Record<ReachMode, { button: string; hint: string; empty: string }> = {
  dependents: {
    button: "Blast radius",
    hint: "What could break if this file changes: files that import it, and files that import those",
    empty: "Nothing in the repository imports it, so a change here reaches no other file.",
  },
  dependencies: {
    button: "Dependency chain",
    hint: "What this file needs: files it imports, and files those import",
    empty: "It imports nothing in the repository.",
  },
};

const DEPTH_LABELS: Record<number, string> = { 1: "Directly", 2: "Two steps away" };

/** Ranked lists show this many rows until asked for the rest. */
const RANKED_PREVIEW = 8;

interface DetailPaneProps {
  map: MapController;
  files: readonly DetailFile[];
  edges: readonly MapEdge[];
  facts: RepoFacts;
  /** Lives above the pane so it survives the selection changing. */
  tab: DetailTab;
  onTab: (tab: DetailTab) => void;
  /** Also lives above the pane: an open walk stays open as the selection moves. */
  reachMode: ReachMode | null;
  onReachMode: (mode: ReachMode | null) => void;
}

/**
 * The right-hand pane. With nothing selected it summarises the repository;
 * that is its resting state. A selected file or folder gets Structure and
 * Explanation tabs. Everything comes from data already in the browser.
 */
export function DetailPane({ map, files, edges, facts, tab, onTab, reachMode, onReachMode }: DetailPaneProps) {
  const fileByPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const known = useMemo(() => conventions(facts), [facts]);
  const neighboursOf = useMemo(() => neighbourIndex(edges), [edges]);
  const summary = useMemo(() => repoSummary(files, edges, known), [files, edges, known]);
  const index = useMemo(() => graphIndex(edges), [edges]);
  const found = useMemo(() => insights(files, index, known), [files, index, known]);
  const { selection, hover, fold, view } = map;

  // A pane row is lit when the map hovers its file, or the folder holding it.
  const lit = (path: string) =>
    hover !== null && (hover.file === null ? hover.node === nodeId(fold.groupOf.get(path) ?? "") : hover.file === path);
  const rowProps = { fileByPath, lit, onSelect: map.focusFile, onHover: map.setHover };

  if (selection === null) {
    return <RepoView facts={facts} summary={summary} insights={found} rowProps={rowProps} />;
  }

  const back = (
    <button
      type="button"
      onClick={map.deselect}
      className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
      title="Clear the selection"
    >
      <span aria-hidden>←</span> {facts.name}
    </button>
  );

  if (selection.kind === "row") {
    const file = fileByPath.get(selection.path);
    if (!file) return null;
    const { imports, importedBy } = neighboursOf(file.path);
    const roles = known.of(file.path);
    return (
      <Frame back={back} kicker="File" title={file.path} tab={tab} onTab={onTab}>
        <Section>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-fg-muted">Category</dt>
            <dd className="flex min-w-0 items-center gap-1.5">
              <Swatch color={roleColor(file.role)} />
              {ROLES[file.role].name}
            </dd>
            <dt className="text-fg-muted">Kind</dt>
            <dd className="min-w-0">
              {LANGUAGE_NAMES[file.language]} <span className="font-mono text-xs text-fg-muted">.{file.language}</span>
            </dd>
            <dt className="text-fg-muted">Role</dt>
            <dd className="min-w-0">
              {roles.length === 0 ? (
                <span className="text-fg-muted">No convention identifies it</span>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {roles.map((c) => (
                    <li key={`${c.id}:${c.detail ?? ""}`}>
                      {c.label}
                      {c.detail && <span className="ml-1.5 font-mono text-xs break-all text-fg-muted">{c.detail}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
            <dt className="text-fg-muted">Length</dt>
            <dd className="tabular-nums">{file.lineCount.toLocaleString()} lines</dd>
          </dl>
        </Section>
        <Section>
          <div className="grid grid-cols-2 gap-2">
            <Stat value={imports.length} label="it depends on" />
            <Stat value={importedBy.length} label="depend on it" />
          </div>
        </Section>
        <ReachSection path={file.path} index={index} mode={reachMode} onMode={onReachMode} rowProps={rowProps} />
        <FileList title="Imports" hint="Files this one imports" files={imports} rowProps={rowProps} empty="Imports nothing in the repository." />
        <FileList title="Imported by" hint="Files that import this one" files={importedBy} rowProps={rowProps} empty="Nothing in the repository imports it." />
      </Frame>
    );
  }

  const node = view.nodes.find((n) => n.id === selection.id);
  const folder = node ? folderSummary(fold, node.dir, fileByPath, known) : null;
  if (!node || !folder) return null;
  return (
    <Frame back={back} kicker="Folder" title={node.dir === "." ? `${facts.name} (root)` : node.dir} tab={tab} onTab={onTab}>
      <Section>
        <div className="grid grid-cols-3 gap-2">
          <Stat value={folder.files.length} label="files" />
          <Stat value={node.stats.fanIn} label="import it" title="Files outside this folder that import something in it" />
          <Stat value={node.stats.fanOut} label="it imports" title="Files outside this folder that something in it imports" />
        </div>
      </Section>
      <Section title="Categories">
        <ul className="flex flex-col gap-1 text-sm">
          {node.stats.roles.map(({ role, count }) => (
            <CountRow key={role} swatch={roleColor(role)} label={ROLES[role].name} count={count} />
          ))}
        </ul>
      </Section>
      <Section title="Kinds of file">
        <ul className="flex flex-col gap-1 text-sm">
          {folder.languages.map(({ language, count }) => (
            <CountRow key={language} label={LANGUAGE_NAMES[language]} sub={`.${language}`} count={count} />
          ))}
        </ul>
      </Section>
      <Section title="Roles">
        <ul className="flex flex-col gap-1 text-sm">
          {folder.conventions.map(({ id, count }) => (
            <CountRow key={id} label={CONVENTION_LABELS[id]} count={count} />
          ))}
          <CountRow label="No convention identifies them" count={folder.unidentified} muted />
        </ul>
      </Section>
      <FileList title="Files" hint="Most depended-on first" files={folder.files} rowProps={rowProps} showFanIn />
    </Frame>
  );
}

function RepoView({
  facts,
  summary,
  insights,
  rowProps,
}: {
  facts: RepoFacts;
  summary: ReturnType<typeof repoSummary>;
  insights: Insights;
  rowProps: RowProps;
}) {
  return (
    <div className="flex flex-col">
      <header className="border-b border-border px-4 pt-4 pb-3">
        <p className="text-[11px] font-medium tracking-wide text-fg-muted uppercase">Repository</p>
        <h2 className="mt-0.5 truncate text-base font-semibold" title={facts.name}>
          {facts.name}
        </h2>
        <p className="mt-1 text-xs text-fg-muted">
          Framework: <span className="text-fg">{facts.framework}</span>
        </p>
      </header>
      <Section>
        <div className="grid grid-cols-3 gap-2">
          <Stat value={summary.fileCount} label="files" />
          <Stat value={facts.importCount} label="imports" title={`${summary.edgeCount.toLocaleString()} distinct links between files in the repository`} />
          <Stat value={facts.routes.length} label="routes" />
        </div>
        <p className="mt-2 text-xs text-fg-muted">
          {summary.edgeCount.toLocaleString()} of those imports link one file here to another.
        </p>
      </Section>
      <RankedList
        title="Most depended on"
        hint="What the rest of the repository leans on, by how many files import it"
        files={summary.mostDependedOn}
        rowProps={rowProps}
        empty="No file imports another."
      />
      <RankedList
        title="Start reading here"
        hint="Nothing imports these. Entry points and routes first, tests last"
        files={summary.startHere}
        rowProps={rowProps}
        empty="Every file is imported by another."
        showFanOut
      />
      <Section title="Unidentified">
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{summary.unidentified.toLocaleString()}</span>
          <span className="text-fg-muted"> of {summary.fileCount.toLocaleString()} files match no convention</span>
        </p>
        <p className="mt-1 text-xs text-fg-muted">Not a route, entry point, test or config file.</p>
      </Section>
      <InsightsPanel insights={insights} rowProps={rowProps} />
    </div>
  );
}

/**
 * Blast radius and dependency chain: the same walk over the edge list in
 * opposite directions, two levels deep. Computed in the browser on click.
 */
function ReachSection({
  path,
  index,
  mode,
  onMode,
  rowProps,
}: {
  path: string;
  index: GraphIndex;
  mode: ReachMode | null;
  onMode: (mode: ReachMode | null) => void;
  rowProps: RowProps;
}) {
  const reached = useMemo(() => (mode === null ? [] : reach(index, path, mode)), [index, path, mode]);
  const levels = Array.from({ length: REACH_DEPTH }, (_, i) => ({ depth: i + 1, files: reached.filter((r) => r.depth === i + 1) }));
  return (
    <Section>
      <div className="grid grid-cols-2 gap-2">
        {(["dependents", "dependencies"] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => onMode(mode === id ? null : id)}
            title={REACH_LABELS[id].hint}
            className={`rounded-md border px-2.5 py-1.5 text-sm font-medium ${
              mode === id ? "border-accent bg-accent/12 text-fg" : "border-border hover:border-fg-muted hover:bg-surface-muted"
            }`}
          >
            {REACH_LABELS[id].button}
          </button>
        ))}
      </div>
      {mode !== null && (
        <div className="mt-3">
          <h3 className="text-xs font-medium tracking-wide text-fg-muted uppercase">
            {REACH_LABELS[mode].button} · {reached.length}
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">{REACH_LABELS[mode].hint}. Two levels deep.</p>
          {reached.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">{REACH_LABELS[mode].empty}</p>
          ) : (
            levels
              .filter((level) => level.files.length > 0)
              .map((level) => (
                <div key={level.depth} className="mt-2">
                  <p className="text-[11px] text-fg-muted">
                    {DEPTH_LABELS[level.depth] ?? `${level.depth} steps away`} · {level.files.length}
                  </p>
                  <ul className="-mx-1.5 mt-1 flex flex-col">
                    {level.files.map((r) => (
                      <FileRow key={r.path} path={r.path} rowProps={rowProps} />
                    ))}
                  </ul>
                </div>
              ))
          )}
        </div>
      )}
    </Section>
  );
}

const INSIGHT_TITLES: Record<InsightKind, string> = {
  unimported: "Nothing imports",
  hub: "Heavily imported",
  cycle: "Import cycles",
  oversized: "Long files",
};

/**
 * The four insights, under one header that starts collapsed. This pane
 * explains a repository before it says anything that reads like a verdict,
 * so the panel is never open by default and files nothing imports lead.
 */
function InsightsPanel({ insights, rowProps }: { insights: Insights; rowProps: RowProps }) {
  const [open, setOpen] = useState(false);
  const counts: Record<InsightKind, number> = {
    unimported: insights.unimported.length,
    hub: insights.hubs.length,
    cycle: insights.cycles.length,
    oversized: insights.oversized.length,
  };
  return (
    <section className="border-b border-border last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="insights-panel"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-surface-muted"
      >
        <span aria-hidden className={`text-[10px] text-fg-muted transition-transform ${open ? "rotate-90" : ""}`}>
          ▶
        </span>
        <span className="flex-1 text-xs font-medium tracking-wide text-fg-muted uppercase">Insights</span>
        <span className="text-[11px] text-fg-muted">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div id="insights-panel" className="flex flex-col">
          {INSIGHT_ORDER.map((kind) => (
            <div key={kind} className="border-t border-border px-4 py-3">
              <h3 className="text-xs font-medium tracking-wide text-fg-muted uppercase">
                {INSIGHT_TITLES[kind]} · {counts[kind]}
              </h3>
              <p className="mt-0.5 text-xs text-fg-muted">{INSIGHT_SENTENCES[kind]}</p>
              <div className="mt-2">
                {kind === "unimported" && (
                  <PreviewList
                    files={insights.unimported}
                    rowProps={rowProps}
                    empty="Every file is imported, or reached some other known way."
                    trailing={(f) => <Trailing title={`Imports ${f.fanOut} files`}>→{f.fanOut}</Trailing>}
                  />
                )}
                {kind === "hub" && (
                  <>
                    <p className="mb-1 text-[11px] text-fg-muted">Imported by {insights.hubThreshold} or more files.</p>
                    <PreviewList
                      files={insights.hubs}
                      rowProps={rowProps}
                      empty="No file is imported by that many."
                      trailing={(f) => <Trailing title={`${f.fanIn} files import it`}>{f.fanIn}</Trailing>}
                    />
                  </>
                )}
                {kind === "cycle" &&
                  (insights.cycles.length === 0 ? (
                    <p className="text-sm text-fg-muted">No file imports its way back to itself.</p>
                  ) : (
                    <ol className="flex flex-col gap-2">
                      {insights.cycles.map((cycle) => (
                        <li key={cycle[0]}>
                          <p className="text-[11px] text-fg-muted">{cycle.length === 1 ? "Imports itself" : `${cycle.length} files`}</p>
                          <PreviewList files={cycle.map((p) => rowProps.fileByPath.get(p)!)} rowProps={rowProps} empty="" />
                        </li>
                      ))}
                    </ol>
                  ))}
                {kind === "oversized" && (
                  <PreviewList
                    files={insights.oversized}
                    rowProps={rowProps}
                    empty="No file is that long."
                    trailing={(f) => <Trailing title={`${f.lineCount.toLocaleString()} lines`}>{f.lineCount.toLocaleString()}</Trailing>}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Trailing({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span className="font-mono text-[11px] text-fg-muted tabular-nums" title={title}>
      {children}
    </span>
  );
}

/** A file list that shows RANKED_PREVIEW rows until asked for the rest. */
function PreviewList({
  files,
  rowProps,
  empty,
  trailing,
}: {
  files: readonly DetailFile[];
  rowProps: RowProps;
  empty: string;
  trailing?: (file: DetailFile) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  if (files.length === 0) return <p className="text-sm text-fg-muted">{empty}</p>;
  const shown = all ? files : files.slice(0, RANKED_PREVIEW);
  return (
    <>
      <ul className="-mx-1.5 flex flex-col">
        {shown.map((f) => (
          <FileRow key={f.path} path={f.path} rowProps={rowProps} trailing={trailing?.(f)} />
        ))}
      </ul>
      {files.length > RANKED_PREVIEW && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1.5 text-xs text-accent hover:underline">
          {all ? "Show fewer" : `Show all ${files.length}`}
        </button>
      )}
    </>
  );
}

function Frame({
  back,
  kicker,
  title,
  tab,
  onTab,
  children,
}: {
  back: ReactNode;
  kicker: string;
  title: string;
  tab: DetailTab;
  onTab: (tab: DetailTab) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-surface px-4 pt-3">
        {back}
        <p className="mt-2 text-[11px] font-medium tracking-wide text-fg-muted uppercase">{kicker}</p>
        <h2 className="mt-0.5 font-mono text-[13px] leading-5 font-medium break-all">{title}</h2>
        <div role="tablist" aria-label="Detail" className="mt-3 flex gap-4 text-sm">
          {(["structure", "explanation"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`detail-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="detail-tabpanel"
              onClick={() => onTab(id)}
              className={`-mb-px border-b-2 pb-2 capitalize ${tab === id ? "border-accent font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg"}`}
            >
              {id}
            </button>
          ))}
        </div>
      </header>
      <div role="tabpanel" id="detail-tabpanel" aria-labelledby={`detail-tab-${tab}`} className="flex flex-col">
        {tab === "structure" ? (
          children
        ) : (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium">No explanation yet</p>
            <p className="mt-1 text-xs text-fg-muted">
              Explanations will describe what the parser found here. Nothing writes them yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-3 last:border-b-0">
      {title && (
        <h3 className="text-xs font-medium tracking-wide text-fg-muted uppercase" title={hint}>
          {title}
        </h3>
      )}
      {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
      <div className={title || hint ? "mt-2" : undefined}>{children}</div>
    </section>
  );
}

function Stat({ value, label, title }: { value: number; label: string; title?: string }) {
  return (
    <div className="rounded-md bg-surface-muted px-2.5 py-2" title={title}>
      <div className="text-lg leading-6 font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-[11px] leading-4 text-fg-muted">{label}</div>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />;
}

function CountRow({ swatch, label, sub, count, muted }: { swatch?: string; label: string; sub?: string; count: number; muted?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      {swatch && <Swatch color={swatch} />}
      <span className={`min-w-0 flex-1 truncate ${muted ? "text-fg-muted" : ""}`}>
        {label}
        {sub && <span className="ml-1.5 font-mono text-xs text-fg-muted">{sub}</span>}
      </span>
      <span className="font-mono text-xs tabular-nums">{count}</span>
    </li>
  );
}

interface RowProps {
  fileByPath: ReadonlyMap<string, DetailFile>;
  lit: (path: string) => boolean;
  onSelect: (path: string) => void;
  onHover: MapController["setHover"];
}

/**
 * Every path in the pane is one of these: clicking moves the map's selection
 * to the file, hovering lights it on the map.
 */
function FileRow({ path, trailing, rowProps }: { path: string; trailing?: ReactNode; rowProps: RowProps }) {
  const { fileByPath, lit, onSelect, onHover } = rowProps;
  const file = fileByPath.get(path);
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const dir = slash < 0 ? "" : path.slice(0, slash + 1);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(path)}
        onMouseEnter={() => onHover({ kind: "file", path })}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover({ kind: "file", path })}
        onBlur={() => onHover(null)}
        title={path}
        className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-surface-muted ${lit(path) ? "bg-accent/15 ring-1 ring-accent ring-inset" : ""}`}
      >
        {file && <Swatch color={roleColor(file.role)} />}
        <span className="flex min-w-0 flex-1 items-baseline font-mono text-[12px]">
          <span className="min-w-0 shrink truncate text-fg-muted" dir="rtl">
            {/* rtl truncates from the left, keeping the end of the directory; the bdi keeps slashes in order. */}
            <bdi>{dir}</bdi>
          </span>
          <span className="shrink-0">{name}</span>
        </span>
        {trailing}
      </button>
    </li>
  );
}

function FileList({
  title,
  hint,
  files,
  rowProps,
  empty,
  showFanIn,
}: {
  title: string;
  hint: string;
  files: readonly ({ path: string; typeOnly?: boolean } | DetailFile)[];
  rowProps: RowProps;
  empty?: string;
  showFanIn?: boolean;
}) {
  return (
    <Section title={`${title} · ${files.length}`} hint={hint}>
      {files.length === 0 ? (
        <p className="text-sm text-fg-muted">{empty}</p>
      ) : (
        <ul className="-mx-1.5 flex flex-col">
          {files.map((f) => (
            <FileRow
              key={f.path}
              path={f.path}
              rowProps={rowProps}
              trailing={
                showFanIn && "fanIn" in f ? (
                  <span className="font-mono text-[11px] text-fg-muted tabular-nums" title={`${f.fanIn} files import it`}>
                    {f.fanIn}
                  </span>
                ) : "typeOnly" in f && f.typeOnly ? (
                  <span className="text-[10px] text-fg-muted" title="Only types are imported">
                    type
                  </span>
                ) : undefined
              }
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function RankedList({
  title,
  hint,
  files,
  rowProps,
  empty,
  showFanOut,
}: {
  title: string;
  hint: string;
  files: readonly DetailFile[];
  rowProps: RowProps;
  empty: string;
  showFanOut?: boolean;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? files : files.slice(0, RANKED_PREVIEW);
  return (
    <Section title={`${title} · ${files.length}`} hint={hint}>
      {files.length === 0 ? (
        <p className="text-sm text-fg-muted">{empty}</p>
      ) : (
        <>
          <ul className="-mx-1.5 flex flex-col">
            {shown.map((f) => (
              <FileRow
                key={f.path}
                path={f.path}
                rowProps={rowProps}
                trailing={
                  <span
                    className="font-mono text-[11px] text-fg-muted tabular-nums"
                    title={showFanOut ? `Imports ${f.fanOut} files` : `${f.fanIn} files import it`}
                  >
                    {showFanOut ? `→${f.fanOut}` : f.fanIn}
                  </span>
                }
              />
            ))}
          </ul>
          {files.length > RANKED_PREVIEW && (
            <button type="button" onClick={() => setAll(!all)} className="mt-1.5 text-xs text-accent hover:underline">
              {all ? "Show fewer" : `Show all ${files.length}`}
            </button>
          )}
        </>
      )}
    </Section>
  );
}
