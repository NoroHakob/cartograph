"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useReactFlow,
  useStore,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fold, type Fold } from "@/map/fold";
import type { Language } from "@/parser/types";
import { layoutView, type MapLayout } from "@/map/layout";
import { onScreen, refitToInclude, unionOf } from "@/map/refit";
import { highlightFor, type Highlight, type Selection } from "@/map/selection";
import { computeView, groupStats, nodeId, PANEL_ROW_LIMIT, rowOrder, type MapEdge, type MapFile, type MapView } from "@/map/view";
import {
  FolderNode,
  MapActionsContext,
  MapHoverContext,
  PanelNode,
  type FolderNodeType,
  type HoverTarget,
  type MapActions,
  type PanelNodeType,
} from "./map-nodes";

const nodeTypes: NodeTypes = { folder: FolderNode, panel: PanelNode };

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;

// Stacking: folded nodes 0, edges 0, lit edges 1, open panels above them all.
const LIT_EDGE_Z = 1;
const PANEL_Z = 2;

/** Something the pointer is over, on the map or in the detail pane. */
export type Hover = { kind: "node"; id: string } | { kind: "file"; path: string };

export interface MapController {
  fold: Fold;
  view: MapView;
  layout: MapLayout;
  highlight: Highlight | null;
  selection: Selection | null;
  hover: HoverTarget | null;
  /** The rail's chosen category. Files outside it dim; nothing is removed. */
  category: Language | null;
  setCategory: (category: Language | null) => void;
  actions: MapActions;
  /** Opens the folder holding `path`, scrolls its row into view and selects it. */
  focusFile: (path: string) => void;
  deselect: () => void;
  setHover: (hover: Hover | null) => void;
  onNodeClick: NodeMouseHandler;
}

/**
 * Everything the map knows about what is open, selected and hovered. It lives
 * above the canvas so the detail pane reads and drives the same state. Must
 * be called inside a ReactFlowProvider.
 */
export function useMapController(files: readonly MapFile[], edges: readonly MapEdge[], rootName: string): MapController {
  const folded = useMemo(() => fold(files), [files]);
  const stats = useMemo(() => groupStats(folded, files, edges), [folded, files, edges]);

  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [scroll, setScroll] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [hoverState, setHover] = useState<Hover | null>(null);
  const [category, setCategory] = useState<Language | null>(null);

  const view = useMemo(
    () => computeView(folded, stats, files, edges, open, rootName, scroll),
    [folded, stats, files, edges, open, rootName, scroll],
  );
  const layout = useMemo(() => layoutView(view), [view]);
  const highlight = useMemo(() => highlightFor(view, selection), [view, selection]);

  // A hovered file resolves to the node holding it, so a folded folder can
  // light up for a file it hides.
  const hover = useMemo<HoverTarget | null>(() => {
    if (hoverState === null) return null;
    if (hoverState.kind === "node") return { node: hoverState.id, file: null };
    const dir = folded.groupOf.get(hoverState.path);
    return dir === undefined ? null : { node: nodeId(dir), file: hoverState.path };
  }, [hoverState, folded]);

  // Opening relayouts the whole map. The refit runs after the render that
  // carries the new layout, so it fits the panel where it is now, not where
  // the folder was. Nodes that were on screen before the click are tracked by
  // id and kept on screen too, wherever the relayout moved them. A request
  // that changes no layout still bumps `fitRequest`, so it never goes stale.
  const pendingFit = useRef<{ panel: string; keep: string[] } | null>(null);
  const [fitRequest, setFitRequest] = useState(0);
  const { getViewport, setViewport } = useReactFlow();
  const screenWidth = useStore((s) => s.width);
  const screenHeight = useStore((s) => s.height);
  useEffect(() => {
    const pending = pendingFit.current;
    if (pending === null) return;
    pendingFit.current = null;
    const boxes = [pending.panel, ...pending.keep].map((id) => layout.boxes.get(id)).filter((b) => b !== undefined);
    if (boxes.length === 0 || screenWidth === 0 || screenHeight === 0) return;
    const next = refitToInclude(getViewport(), { width: screenWidth, height: screenHeight }, unionOf(boxes), MIN_ZOOM);
    if (next) void setViewport(next, { duration: 250 });
  }, [layout, fitRequest, getViewport, setViewport, screenWidth, screenHeight]);

  const requestFit = useCallback(
    (panel: string) => {
      pendingFit.current = { panel, keep: onScreen(getViewport(), { width: screenWidth, height: screenHeight }, layout.boxes) };
      setFitRequest((n) => n + 1);
    },
    [layout, getViewport, screenWidth, screenHeight],
  );

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (node.type !== "folder") return; // panels handle their own clicks
      const dir = (node as FolderNodeType).data.node.dir;
      requestFit(node.id);
      setOpen((current) => new Set(current).add(dir));
      setSelection({ kind: "node", id: node.id });
    },
    [requestFit],
  );

  const fileByPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const focusFile = useCallback(
    (path: string) => {
      const dir = folded.groupOf.get(path);
      if (dir === undefined) return;
      const id = nodeId(dir);
      // Rows sit in panel order; move the window only if the row is outside it.
      const rows = folded.groups.find((g) => g.dir === dir)!.files.map((p) => fileByPath.get(p)!).sort(rowOrder);
      const index = rows.findIndex((f) => f.path === path);
      const start = open.has(dir) ? (view.nodes.find((n) => n.id === id)?.windowStart ?? 0) : 0;
      if (index < start || index >= start + PANEL_ROW_LIMIT) {
        setScroll((current) => new Map(current).set(dir, Math.max(0, index - Math.floor(PANEL_ROW_LIMIT / 2))));
      }
      requestFit(id);
      setOpen((current) => (current.has(dir) ? current : new Set(current).add(dir)));
      setSelection({ kind: "row", node: id, path });
    },
    [folded, fileByPath, open, view, requestFit],
  );

  const actions = useMemo<MapActions>(
    () => ({
      close: (dir) => {
        setOpen((current) => {
          const next = new Set(current);
          next.delete(dir);
          return next;
        });
        // A selected row goes away with its panel, and it reopens at the top.
        setSelection((current) => (current?.kind === "row" && current.node === nodeId(dir) ? null : current));
        setScroll((current) => {
          const next = new Map(current);
          next.delete(dir);
          return next;
        });
      },
      select: setSelection,
      scroll: (dir, start) => setScroll((current) => new Map(current).set(dir, start)),
      hover: setHover,
    }),
    [],
  );

  const deselect = useCallback(() => setSelection(null), []);

  return { fold: folded, view, layout, highlight, selection, hover, category, setCategory, actions, focusFile, deselect, setHover, onNodeClick };
}

/** The canvas. All state comes from the controller. */
export function DependencyMap({ map, files }: { map: MapController; files: readonly MapFile[] }) {
  const { view, layout, highlight, selection, hover, category, actions, deselect, setHover, onNodeClick } = map;

  // An edge stays in the chosen category when a file at either end is in it.
  const inCategory = useMemo(() => {
    if (category === null) return null;
    const matching = new Set(files.filter((f) => f.language === category).map((f) => f.path));
    return (edge: MapView["edges"][number]) => edge.sourceFiles.some((p) => matching.has(p)) || edge.targetFiles.some((p) => matching.has(p));
  }, [files, category]);

  const nodes = useMemo(
    () =>
      view.nodes.map((node): FolderNodeType | PanelNodeType => {
        const box = layout.boxes.get(node.id)!;
        return {
          id: node.id,
          type: node.open ? "panel" : "folder",
          position: { x: box.x, y: box.y },
          width: box.width,
          height: box.height,
          data: { node, highlight, selection, category },
          // Panels sit above every edge, lit ones included, so lines pass
          // beneath an open folder and never across its rows.
          zIndex: node.open ? PANEL_Z : 0,
        };
      }),
    [view, layout, highlight, selection, category],
  );

  const flowEdges = useMemo(
    () =>
      view.edges.map((edge): Edge => {
        const direction = highlight?.edges.get(edge.id);
        const lit = direction !== undefined;
        const dim = (highlight !== null && !lit) || (inCategory !== null && !inCategory(edge));
        // A selected file shows which way each import runs: green for files
        // that import it, amber for files it imports.
        const litStroke = selection?.kind !== "row" ? "var(--accent)" : direction === "in" ? "var(--edge-in)" : "var(--edge-out)";
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          focusable: false,
          zIndex: lit ? LIT_EDGE_Z : 0,
          style: {
            stroke: lit ? litStroke : "var(--fg-muted)",
            strokeWidth: Math.min(3, 1 + Math.log2(edge.count) * 0.5) + (lit ? 0.5 : 0),
            strokeDasharray: edge.typeOnly ? "4 3" : undefined,
            opacity: dim ? 0.08 : lit ? 0.95 : 0.4,
          },
        };
      }),
    [view, highlight, selection, inCategory],
  );

  return (
    <MapActionsContext value={actions}>
      <MapHoverContext value={hover}>
        <ReactFlow
          nodes={nodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          // Panels report hover per row and header themselves.
          onNodeMouseEnter={(_, node) => {
            if (node.type === "folder") setHover({ kind: "node", id: node.id });
          }}
          onNodeMouseLeave={(_, node) => {
            if (node.type === "folder") setHover(null);
          }}
          onPaneClick={deselect}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          className="cartograph-map"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
        </ReactFlow>
      </MapHoverContext>
    </MapActionsContext>
  );
}
