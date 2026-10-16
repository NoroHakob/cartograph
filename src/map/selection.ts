// What stays at full strength when something is selected: the selection, its
// edges, and whatever those edges connect to. Everything else dims.

import { ABOVE_IN, ABOVE_OUT, BELOW_IN, BELOW_OUT, FOLDED_IN, FOLDED_OUT, type MapView, type ViewEdge } from "./view";

export type Selection =
  | { kind: "node"; id: string }
  | { kind: "row"; node: string; path: string };

export interface Highlight {
  /** Lit edges, and whether each comes into the selection or goes out of it. */
  edges: Map<string, "in" | "out">;
  /** Nodes drawn entirely at full strength, rows and all. */
  nodes: Set<string>;
  /** Panels with only some rows lit: the frame stays, unlit rows dim. */
  frames: Set<string>;
  /** Lit rows, by file path. */
  rows: Set<string>;
  /** Panels whose "above" or "below" count is lit. */
  above: Set<string>;
  below: Set<string>;
}

const handlePath = (handle: string) => handle.slice(handle.indexOf(":") + 1);

function light(highlight: Highlight, node: string, handle: string) {
  if (handle === FOLDED_IN || handle === FOLDED_OUT) {
    highlight.nodes.add(node);
  } else if (handle === ABOVE_IN || handle === ABOVE_OUT) {
    highlight.frames.add(node);
    highlight.above.add(node);
  } else if (handle === BELOW_IN || handle === BELOW_OUT) {
    highlight.frames.add(node);
    highlight.below.add(node);
  } else {
    highlight.frames.add(node);
    highlight.rows.add(handlePath(handle));
  }
}

/** Null when nothing is selected, meaning nothing dims. */
export function highlightFor(view: MapView, selection: Selection | null): Highlight | null {
  if (!selection) return null;
  const highlight: Highlight = { edges: new Map(), nodes: new Set(), frames: new Set(), rows: new Set(), above: new Set(), below: new Set() };

  let touches: (edge: ViewEdge) => "source" | "target" | null;
  if (selection.kind === "node") {
    highlight.nodes.add(selection.id);
    touches = (e) => (e.source === selection.id ? "source" : e.target === selection.id ? "target" : null);
  } else {
    highlight.frames.add(selection.node);
    highlight.rows.add(selection.path);
    // Matched by file, not handle: a row scrolled out of view still has its
    // edges, drawn to the panel's "above" or "below" count instead.
    touches = (e) =>
      e.source === selection.node && e.sourceFiles.includes(selection.path)
        ? "source"
        : e.target === selection.node && e.targetFiles.includes(selection.path)
          ? "target"
          : null;
  }

  for (const edge of view.edges) {
    const side = touches(edge);
    if (!side) continue;
    // The selection is the edge's source when it imports, its target when imported.
    highlight.edges.set(edge.id, side === "source" ? "out" : "in");
    if (side === "source") light(highlight, edge.target, edge.targetHandle);
    else light(highlight, edge.source, edge.sourceHandle);
    // A row scrolled out of view lights the count standing in for it.
    if (selection.kind === "row") {
      if (side === "source") light(highlight, edge.source, edge.sourceHandle);
      else light(highlight, edge.target, edge.targetHandle);
    }
  }
  return highlight;
}
