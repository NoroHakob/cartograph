"use client";

import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react";
import { createContext, use, useEffect, useRef, type CSSProperties, type MouseEvent, type UIEvent } from "react";
import { CATEGORY_COLORS } from "@/map/categories";
import { PANEL_HEADER_HEIGHT, PANEL_ROW_HEIGHT } from "@/map/layout";
import type { Highlight, Selection } from "@/map/selection";
import type { Language } from "@/parser/types";
import {
  ABOVE_IN,
  ABOVE_OUT,
  BELOW_IN,
  BELOW_OUT,
  FOLDED_IN,
  FOLDED_OUT,
  PANEL_ROW_LIMIT,
  rowIn,
  rowOut,
  type ViewNode,
} from "@/map/view";

export interface MapActions {
  close: (dir: string) => void;
  select: (selection: Selection) => void;
  /** An open panel's list scrolled so `start` is its first fully visible row. */
  scroll: (dir: string, start: number) => void;
  /** The pointer moved onto a folder or a file, or off everything (null). */
  hover: (hover: { kind: "node"; id: string } | { kind: "file"; path: string } | null) => void;
}

export const MapActionsContext = createContext<MapActions | null>(null);

/** What the pointer is over, here or in the detail pane, resolved to a node. */
export interface HoverTarget {
  /** The node holding the hovered thing. */
  node: string;
  /** The hovered file, or null when a whole folder is hovered. */
  file: string | null;
}

export const MapHoverContext = createContext<HoverTarget | null>(null);

function useMapActions(): MapActions {
  const actions = use(MapActionsContext);
  if (!actions) throw new Error("map nodes render inside MapActionsContext");
  return actions;
}

export type NodeData = {
  node: ViewNode;
  highlight: Highlight | null;
  selection: Selection | null;
  /** The rail's chosen category, or null when every file is at full strength. */
  category: Language | null;
};

export type FolderNodeType = Node<NodeData, "folder">;
export type PanelNodeType = Node<NodeData, "panel">;

// Edges attach to these, but there is nothing to grab: nodes don't connect.
const hiddenHandle: CSSProperties = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

const DIM = "opacity-25";
/** Something hovered in the detail pane, shown on the map. */
const HOVER_RING = "ring-2 ring-accent";

/** How many of a folder's files are in the category, or null with no category chosen. */
function matchCount(node: ViewNode, category: Language | null): number | null {
  if (category === null) return null;
  return node.stats.languages.find((l) => l.language === category)?.count ?? 0;
}

/**
 * How many of a folder's files are in the chosen category, in its colour.
 * Folded nodes are narrow, so they say "3 of 10"; panels say "3 match".
 */
function MatchCount({ count, total, category }: { count: number; total?: number; category: Language }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium text-fg" title={`${count} of ${total ?? "its"} files in this folder are .${category}`}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[category] }} />
      {total === undefined ? `${count} match` : `${count} of ${total}`}
    </span>
  );
}

function LanguageBar({ node }: { node: ViewNode }) {
  return (
    <div aria-hidden className="flex h-1 w-full overflow-hidden rounded-full">
      {node.stats.languages.map(({ language, count }) => (
        <span key={language} style={{ flexGrow: count, backgroundColor: CATEGORY_COLORS[language] }} />
      ))}
    </div>
  );
}

/** A folded folder. Clicking opens it; the map handles that through onNodeClick. */
export function FolderNode({ data }: NodeProps<FolderNodeType>) {
  const { node, highlight, selection, category } = data;
  const selected = selection?.kind === "node" && selection.id === node.id;
  const matched = matchCount(node, category);
  const dim = (highlight !== null && !highlight.nodes.has(node.id)) || matched === 0;
  const hovered = use(MapHoverContext)?.node === node.id;
  return (
    <div
      title={`${node.dir} · ${node.stats.fileCount} files · ${node.stats.fanIn} depend on it`}
      className={`flex h-full w-full cursor-pointer flex-col justify-between rounded-lg border bg-surface px-3.5 py-2 transition-opacity hover:border-fg-muted ${
        selected ? "border-accent ring-2 ring-ring" : "border-border"
      } ${hovered ? `${HOVER_RING} opacity-100` : dim ? DIM : ""}`}
    >
      <Handle type="target" position={Position.Left} id={FOLDED_IN} style={hiddenHandle} isConnectable={false} />
      <div className="min-w-0">
        <div className="truncate text-[13px] leading-5 font-medium">{node.label}</div>
        <div className="text-[11px] leading-4 text-fg-muted tabular-nums">
          {matched !== null && category !== null ? (
            <MatchCount count={matched} total={node.stats.fileCount} category={category} />
          ) : (
            `${node.stats.fileCount} files`
          )}
        </div>
      </div>
      <LanguageBar node={node} />
      <Handle type="source" position={Position.Right} id={FOLDED_OUT} style={hiddenHandle} isConnectable={false} />
    </div>
  );
}

/**
 * An opened folder: one bordered box, a header that closes it, and a row per
 * file. Long folders scroll inside the box, which never grows past
 * PANEL_ROW_LIMIT rows. Rows in the scrolled window carry their own handles
 * so edges land on the file; edges for rows scrolled out of view land on the
 * header (above) or the footer (below).
 */
export function PanelNode({ id, data }: NodeProps<PanelNodeType>) {
  const { node, highlight, selection, category } = data;
  const { close, select, scroll, hover } = useMapActions();
  const matched = matchCount(node, category);
  const hovering = use(MapHoverContext);
  const listRef = useRef<HTMLUListElement>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const whole = highlight === null || highlight.nodes.has(node.id);
  const dimFrame = (!whole && !highlight.frames.has(node.id)) || matched === 0;
  const dimRow = (path: string, language: Language) => (!whole && !highlight.rows.has(path)) || (category !== null && language !== category);
  const dimAbove = !whole && !highlight.above.has(node.id);
  const dimBelow = !whole && !highlight.below.has(node.id);
  const selected = selection?.kind === "node" && selection.id === node.id;
  const scrollable = node.rows.length > PANEL_ROW_LIMIT;
  const windowEnd = node.windowStart + PANEL_ROW_LIMIT;
  const hoveredRow = hovering?.node === node.id ? hovering.file : null;
  // The panel rings when it is hovered whole, or for a row scrolled out of view.
  const hoveredFrame =
    hovering?.node === node.id &&
    (hoveredRow === null || !node.rows.slice(node.windowStart, windowEnd).some((r) => r.path === hoveredRow));
  const stop = (fn: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    fn();
  };

  // Which rows have handles changes with the window, and React Flow only
  // re-reads handle positions when told to.
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, node.windowStart, updateNodeInternals]);

  // The window can move without the list scrolling, when a file is focused
  // from the detail pane. Bring the list to it.
  useEffect(() => {
    const list = listRef.current;
    if (list && Math.round(list.scrollTop / PANEL_ROW_HEIGHT) !== node.windowStart) {
      list.scrollTop = node.windowStart * PANEL_ROW_HEIGHT;
    }
  }, [node.windowStart]);

  const onScroll = (event: UIEvent<HTMLUListElement>) => {
    const start = Math.round(event.currentTarget.scrollTop / PANEL_ROW_HEIGHT);
    if (start !== node.windowStart) scroll(node.dir, start);
    else updateNodeInternals(id); // still settling onto a row: keep edges on it
  };

  return (
    <div
      onClick={() => select({ kind: "node", id: node.id })}
      className={`flex h-full w-full cursor-default flex-col overflow-hidden rounded-lg border bg-surface shadow-sm transition-opacity ${
        selected ? "border-accent ring-2 ring-ring" : "border-fg-muted/50"
      } ${hoveredFrame ? HOVER_RING : ""} ${dimFrame && !hoveredFrame ? DIM : ""}`}
    >
      <button
        type="button"
        onClick={stop(() => close(node.dir))}
        onMouseEnter={() => hover({ kind: "node", id: node.id })}
        onMouseLeave={() => hover(null)}
        title={`Close ${node.dir}`}
        style={{ height: PANEL_HEADER_HEIGHT }}
        className="relative flex shrink-0 flex-col justify-center gap-1 border-b border-border bg-surface-muted px-3 text-left hover:bg-border/60"
      >
        {scrollable && <Handle type="target" position={Position.Left} id={ABOVE_IN} style={hiddenHandle} isConnectable={false} />}
        {scrollable && <Handle type="source" position={Position.Right} id={ABOVE_OUT} style={hiddenHandle} isConnectable={false} />}
        <span className="truncate text-[13px] leading-4 font-semibold">{node.label}</span>
        <span className="flex items-center gap-2 text-[11px] leading-4 text-fg-muted tabular-nums">
          <span>{node.stats.fileCount} files</span>
          {matched !== null && category !== null && <MatchCount count={matched} category={category} />}
          <span aria-hidden>·</span>
          <span title="Files outside this folder that import it">in {node.stats.fanIn}</span>
          <span title="Files outside this folder it imports">out {node.stats.fanOut}</span>
        </span>
      </button>
      <ul
        ref={listRef}
        onScroll={scrollable ? onScroll : undefined}
        // nowheel: the wheel scrolls the list instead of zooming the map.
        className={`flex shrink-0 flex-col scrollbar-thin ${scrollable ? "nowheel snap-y snap-mandatory overflow-y-auto overscroll-contain" : ""}`}
        style={{ height: Math.min(node.rows.length, PANEL_ROW_LIMIT) * PANEL_ROW_HEIGHT }}
      >
        {node.rows.map((row, index) => {
          const rowSelected = selection?.kind === "row" && selection.path === row.path;
          const inWindow = index >= node.windowStart && index < windowEnd;
          return (
            <li key={row.path} className="relative shrink-0 snap-start" style={{ height: PANEL_ROW_HEIGHT }}>
              {inWindow && <Handle type="target" position={Position.Left} id={rowIn(row.path)} style={hiddenHandle} isConnectable={false} />}
              <button
                type="button"
                onClick={stop(() => select({ kind: "row", node: node.id, path: row.path }))}
                onMouseEnter={() => hover({ kind: "file", path: row.path })}
                onMouseLeave={() => hover(null)}
                title={`${row.path} · ${row.fanIn} files import it`}
                aria-pressed={rowSelected}
                className={`flex h-full w-full items-center gap-2 px-3 text-left transition-opacity hover:bg-surface-muted ${
                  rowSelected ? "bg-accent/12" : ""
                } ${hoveredRow === row.path ? "bg-accent/20 ring-2 ring-accent ring-inset" : dimRow(row.path, row.language) ? DIM : ""}`}
              >
                <span aria-hidden className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: CATEGORY_COLORS[row.language] }} />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{row.label}</span>
                <span className="font-mono text-[11px] text-fg-muted tabular-nums">{row.fanIn}</span>
              </button>
              {inWindow && <Handle type="source" position={Position.Right} id={rowOut(row.path)} style={hiddenHandle} isConnectable={false} />}
            </li>
          );
        })}
      </ul>
      {scrollable && (
        <div
          className="relative flex shrink-0 items-center gap-1.5 border-t border-border px-3 text-[11px] text-fg-muted tabular-nums"
          style={{ height: PANEL_ROW_HEIGHT }}
        >
          <Handle type="target" position={Position.Left} id={BELOW_IN} style={hiddenHandle} isConnectable={false} />
          <span className={`transition-opacity ${dimAbove ? DIM : ""}`}>{node.hiddenAbove} above</span>
          <span aria-hidden>·</span>
          <span className={`transition-opacity ${dimBelow ? DIM : ""}`}>{node.hiddenBelow} below</span>
          <Handle type="source" position={Position.Right} id={BELOW_OUT} style={hiddenHandle} isConnectable={false} />
        </div>
      )}
    </div>
  );
}
