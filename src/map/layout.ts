// Sizes and positions. Width comes from the label, so a long name doesn't read
// as an important file; a folded node's height carries how many files depend
// on it. Same view in, same picture out: nodes and edges enter dagre in a
// fixed order and nothing here measures the DOM.

import { Graph, layout } from "@dagrejs/dagre";
import { PANEL_ROW_LIMIT, type MapView, type ViewNode } from "./view";

/** Whether an open panel has more rows than it shows at once. */
export const scrolls = (node: ViewNode) => node.rows.length > PANEL_ROW_LIMIT;

/** Upper bound on one character of a folded node's label (13px sans, medium). */
const LABEL_CHAR_WIDTH = 8;
/** One character of a panel row (12px mono: 0.6em advance, plus slack). */
const ROW_CHAR_WIDTH = 7.4;

/** Horizontal padding plus border on each side. */
export const FOLDED_PAD_X = 16;
export const FOLDED_MIN_WIDTH = 96;
export const FOLDED_MIN_HEIGHT = 44;
export const FOLDED_MAX_HEIGHT = 132;

export const PANEL_HEADER_HEIGHT = 56;
export const PANEL_ROW_HEIGHT = 26;
export const PANEL_PAD_BOTTOM = 6;
/** Top and bottom border of the panel box. */
const PANEL_BORDER = 2;
export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 380;
/** Swatch, gaps and the fan-in count around a row's label. */
const PANEL_ROW_CHROME = 76;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapLayout {
  boxes: Map<string, Box>;
  bounds: Box;
}

const textWidth = (text: string, charWidth = LABEL_CHAR_WIDTH) => Math.ceil(text.length * charWidth);

/** Log scale against the most depended-on node, so one hub doesn't flatten the rest. */
export function foldedHeight(fanIn: number, maxFanIn: number): number {
  if (maxFanIn <= 0) return FOLDED_MIN_HEIGHT;
  const share = Math.log1p(fanIn) / Math.log1p(maxFanIn);
  return Math.round(FOLDED_MIN_HEIGHT + share * (FOLDED_MAX_HEIGHT - FOLDED_MIN_HEIGHT));
}

export function nodeSize(node: ViewNode, maxFanIn: number): { width: number; height: number } {
  if (!node.open) {
    return {
      width: Math.max(FOLDED_MIN_WIDTH, textWidth(node.label) + FOLDED_PAD_X * 2),
      height: foldedHeight(node.stats.fanIn, maxFanIn),
    };
  }
  const widest = Math.max(textWidth(node.label) + 40, ...node.rows.map((r) => textWidth(r.label, ROW_CHAR_WIDTH) + PANEL_ROW_CHROME));
  // Long folders scroll: the panel holds a window of rows plus a footer with
  // the counts above and below, whichever part of the list is in view.
  const rowCount = Math.min(node.rows.length, PANEL_ROW_LIMIT) + (scrolls(node) ? 1 : 0);
  return {
    width: Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, widest)),
    height: PANEL_BORDER + PANEL_HEADER_HEIGHT + rowCount * PANEL_ROW_HEIGHT + PANEL_PAD_BOTTOM,
  };
}

export function layoutView(view: MapView): MapLayout {
  const maxFanIn = Math.max(0, ...view.nodes.map((n) => n.stats.fanIn));

  const graph = new Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 96, marginx: 24, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));

  const sizes = new Map(view.nodes.map((n) => [n.id, nodeSize(n, maxFanIn)]));
  for (const node of view.nodes) graph.setNode(node.id, { ...sizes.get(node.id)! });

  // dagre lays out node-to-node; several handle-level lines between the same
  // pair are one constraint, weighted by how many imports they carry.
  const weights = new Map<string, { source: string; target: string; weight: number }>();
  for (const edge of view.edges) {
    const key = `${edge.source}\u0000${edge.target}`;
    const pair = weights.get(key) ?? { source: edge.source, target: edge.target, weight: 0 };
    pair.weight += edge.count;
    weights.set(key, pair);
  }
  for (const pair of weights.values()) graph.setEdge(pair.source, pair.target, { weight: pair.weight });

  layout(graph);

  const boxes = new Map<string, Box>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of view.nodes) {
    const { width, height } = sizes.get(node.id)!;
    const { x, y } = graph.node(node.id);
    const box = { x: x - width / 2, y: y - height / 2, width, height };
    boxes.set(node.id, box);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + width);
    maxY = Math.max(maxY, box.y + height);
  }
  const bounds = boxes.size === 0 ? { x: 0, y: 0, width: 0, height: 0 } : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  return { boxes, bounds };
}
