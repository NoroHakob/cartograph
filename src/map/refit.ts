// Refitting after a folder opens. The new panel must end up on screen, and the
// view may only ever zoom out to get it there: fitting to the panel alone
// would zoom into it and lose the rest of the graph.

import type { Box } from "./layout";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** Screen pixels kept clear around the panel. */
const MARGIN = 24;

/** Ids of the boxes at least partly on screen under `viewport`. */
export function onScreen(viewport: Viewport, screen: { width: number; height: number }, boxes: ReadonlyMap<string, Box>): string[] {
  const { x, y, zoom } = viewport;
  const left = -x / zoom;
  const top = -y / zoom;
  const right = left + screen.width / zoom;
  const bottom = top + screen.height / zoom;
  return [...boxes]
    .filter(([, b]) => b.x < right && b.x + b.width > left && b.y < bottom && b.y + b.height > top)
    .map(([id]) => id);
}

/** The smallest box containing all of `boxes`. */
export function unionOf(boxes: readonly Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The viewport that keeps everything currently visible and adds `target`, or
 * null when `target` is already fully on screen. `target` must come from the
 * layout after the change, not before it.
 */
export function refitToInclude(
  current: Viewport,
  screen: { width: number; height: number },
  target: Box,
  minZoom: number,
): Viewport | null {
  const { zoom } = current;
  const visible = { x: -current.x / zoom, y: -current.y / zoom, width: screen.width / zoom, height: screen.height / zoom };
  const margin = MARGIN / zoom;
  const inside =
    target.x - margin >= visible.x &&
    target.y - margin >= visible.y &&
    target.x + target.width + margin <= visible.x + visible.width &&
    target.y + target.height + margin <= visible.y + visible.height;
  if (inside) return null;

  const x0 = Math.min(visible.x, target.x - margin);
  const y0 = Math.min(visible.y, target.y - margin);
  const x1 = Math.max(visible.x + visible.width, target.x + target.width + margin);
  const y1 = Math.max(visible.y + visible.height, target.y + target.height + margin);

  // The union contains the visible area, so this is already <= zoom; the
  // explicit min keeps "never zoom in" true regardless of rounding.
  const fit = Math.min(screen.width / (x1 - x0), screen.height / (y1 - y0));
  const next = Math.max(minZoom, Math.min(zoom, fit));
  return {
    x: screen.width / 2 - ((x0 + x1) / 2) * next,
    y: screen.height / 2 - ((y0 + y1) / 2) * next,
    zoom: next,
  };
}
