"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fold } from "@/map/fold";
import { layoutView } from "@/map/layout";
import { onScreen, refitToInclude, unionOf } from "@/map/refit";
import { highlightFor, type Selection } from "@/map/selection";
import { computeView, groupStats, nodeId, type MapEdge, type MapFile } from "@/map/view";
import { FolderNode, MapActionsContext, PanelNode, type FolderNodeType, type MapActions, type PanelNodeType } from "./map-nodes";

const nodeTypes: NodeTypes = { folder: FolderNode, panel: PanelNode };

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;

// Stacking: folded nodes 0, edges 0, lit edges 1, open panels above them all.
const LIT_EDGE_Z = 1;
const PANEL_Z = 2;

interface DependencyMapProps {
  files: MapFile[];
  edges: MapEdge[];
  /** Shown as the root folder's label. */
  rootName: string;
}

export function DependencyMap(props: DependencyMapProps) {
  return (
    <ReactFlowProvider>
      <MapCanvas {...props} />
    </ReactFlowProvider>
  );
}

function MapCanvas({ files, edges, rootName }: DependencyMapProps) {
  const folded = useMemo(() => fold(files), [files]);
  const stats = useMemo(() => groupStats(folded, files, edges), [folded, files, edges]);

  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [scroll, setScroll] = useState<ReadonlyMap<string, number>>(() => new Map());

  const view = useMemo(
    () => computeView(folded, stats, files, edges, open, rootName, scroll),
    [folded, stats, files, edges, open, rootName, scroll],
  );
  const layout = useMemo(() => layoutView(view), [view]);
  const highlight = useMemo(() => highlightFor(view, selection), [view, selection]);

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
          data: { node, highlight, selection },
          // Panels sit above every edge, lit ones included, so lines pass
          // beneath an open folder and never across its rows.
          zIndex: node.open ? PANEL_Z : 0,
        };
      }),
    [view, layout, highlight, selection],
  );

  const flowEdges = useMemo(
    () =>
      view.edges.map((edge): Edge => {
        const direction = highlight?.edges.get(edge.id);
        const lit = direction !== undefined;
        const dim = highlight !== null && !lit;
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
    [view, highlight, selection],
  );

  // Opening relayouts the whole map. The refit runs after the render that
  // carries the new layout, so it fits the panel where it is now, not where
  // the folder was. Nodes that were on screen before the click are tracked by
  // id and kept on screen too, wherever the relayout moved them.
  const pendingFit = useRef<{ panel: string; keep: string[] } | null>(null);
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
  }, [layout, getViewport, setViewport, screenWidth, screenHeight]);

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (node.type !== "folder") return; // panels handle their own clicks
      const dir = (node as FolderNodeType).data.node.dir;
      const keep = onScreen(getViewport(), { width: screenWidth, height: screenHeight }, layout.boxes);
      pendingFit.current = { panel: node.id, keep };
      setOpen((current) => new Set(current).add(dir));
      setSelection({ kind: "node", id: node.id });
    },
    [layout, getViewport, screenWidth, screenHeight],
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
    }),
    [],
  );

  return (
    <MapActionsContext value={actions}>
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={() => setSelection(null)}
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
    </MapActionsContext>
  );
}
