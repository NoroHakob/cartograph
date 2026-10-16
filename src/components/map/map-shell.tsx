import type { ReactNode } from "react";

/**
 * The map's frame: a narrow rail, the canvas, and a detail pane, always in
 * that order and at these widths. Later phases fill the slots; they don't
 * move, resize or replace the columns. The detail pane is a column, never a
 * modal, drawer or overlay.
 */
export function MapShell({
  rail,
  canvas,
  detail,
}: {
  rail: ReactNode;
  canvas: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="grid h-dvh grid-cols-[13rem_minmax(0,1fr)_20rem] overflow-hidden bg-bg">
      <aside aria-label="File categories" className="min-h-0 overflow-y-auto border-r border-border bg-surface">
        {rail}
      </aside>
      <section aria-label="Dependency map" className="relative min-h-0 min-w-0 overflow-hidden">
        {canvas}
      </section>
      <aside aria-label="Details" className="min-h-0 overflow-y-auto border-l border-border bg-surface">
        {detail}
      </aside>
    </div>
  );
}
