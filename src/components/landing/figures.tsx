// Drawings for the landing page. They're drawn in the canvas's own terms
// (folded folders with a role bar, open panels with file rows, edges that
// light up around a selection) and take every colour from the same tokens and
// role taxonomy the map does. Deliberately unlabelled and static: a name on a
// node would be a claim about somebody's code.

import { useId } from "react";
import { ROLES, type RoleId } from "@/parser/taxonomy";

type Roles = readonly (readonly [RoleId, number])[];

// The map's opacities: a dimmed node, and idle, dimmed and lit edges.
const DIM_NODE = 0.25;
const EDGE_IDLE = 0.4;
const EDGE_DIM = 0.08;
const EDGE_LIT = 0.95;

const FOLDER_H = 50;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Left-to-right bezier from the right side of one point to the left of another, as React Flow draws it. */
function edgePath(sx: number, sy: number, tx: number, ty: number): string {
  const bend = Math.max(40, (tx - sx) / 2);
  return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
}

function Edge({ from, to, stroke = "var(--fg-muted)", opacity = EDGE_IDLE, width = 1.25 }: {
  from: [number, number];
  to: [number, number];
  stroke?: string;
  opacity?: number;
  width?: number;
}) {
  return <path d={edgePath(...from, ...to)} fill="none" stroke={stroke} strokeWidth={width} opacity={opacity} />;
}

function DotGrid({ id }: { id: string }) {
  return (
    <>
      <defs>
        <pattern id={id} width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="1" fill="var(--border)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </>
  );
}

/** The thin bar of role colours along the foot of a folded folder. */
function RoleBar({ x, y, w, roles }: { x: number; y: number; w: number; roles: Roles }) {
  const clip = useId();
  const total = roles.reduce((sum, [, n]) => sum + n, 0);
  const starts = roles.map((_, i) => roles.slice(0, i).reduce((sum, [, n]) => sum + n, 0));
  return (
    <g clipPath={`url(#${clip})`}>
      <defs>
        <clipPath id={clip}>
          <rect x={x} y={y} width={w} height={4} rx={2} />
        </clipPath>
      </defs>
      {roles.map(([role, n], i) => (
        <rect key={role} x={x + (w * starts[i]) / total} y={y} width={(w * n) / total} height={4} fill={ROLES[role].color} />
      ))}
    </g>
  );
}

/** A folded folder: a title line, a file-count line, and its role bar. */
function Folder({ box, roles, title, selected = false, dim = false }: {
  box: Box;
  roles: Roles;
  /** How much of the box the title line spans, 0–1. */
  title: number;
  selected?: boolean;
  dim?: boolean;
}) {
  const { x, y, w, h } = box;
  return (
    <g opacity={dim ? DIM_NODE : 1}>
      {selected && (
        <rect x={x - 2} y={y - 2} width={w + 4} height={h + 4} rx={10} fill="none" stroke="var(--ring)" strokeWidth={4} />
      )}
      <rect x={x} y={y} width={w} height={h} rx={8} fill="var(--surface)" stroke={selected ? "var(--accent)" : "var(--border)"} />
      <rect x={x + 14} y={y + 10} width={(w - 28) * title} height={7} rx={3.5} fill="var(--fg)" opacity={0.75} />
      <rect x={x + 14} y={y + 22} width={30} height={5} rx={2.5} fill="var(--fg-muted)" opacity={0.5} />
      <RoleBar x={x + 14} y={y + h - 11} w={w - 28} roles={roles} />
    </g>
  );
}

const right = (b: Box): [number, number] => [b.x + b.w, b.y + b.h / 2];
const left = (b: Box): [number, number] => [b.x, b.y + b.h / 2];

/* ------------------------------------------------------------------ hero */

const HERO_W = 152;
const hero = {
  a: { x: 24, y: 96, w: HERO_W, h: FOLDER_H },
  b: { x: 24, y: 268, w: HERO_W, h: FOLDER_H },
  c: { x: 224, y: 28, w: HERO_W, h: FOLDER_H },
  d: { x: 224, y: 182, w: HERO_W, h: FOLDER_H },
  e: { x: 224, y: 336, w: HERO_W, h: FOLDER_H },
  f: { x: 424, y: 110, w: HERO_W, h: FOLDER_H },
  g: { x: 424, y: 250, w: HERO_W, h: FOLDER_H },
} satisfies Record<string, Box>;

/** A folded map with one folder selected: its neighbours stay, its edges light, the rest recedes. */
export function HeroMap() {
  const grid = useId();
  const lit = { stroke: "var(--accent)", opacity: EDGE_LIT, width: 1.75 };
  const dim = { opacity: EDGE_DIM };
  return (
    <svg viewBox="0 0 600 420" className="block h-auto w-full" role="img" aria-label="A dependency map folded to folder level, with one folder selected and the imports around it lit.">
      <DotGrid id={grid} />
      <Edge from={right(hero.a)} to={left(hero.c)} {...dim} />
      <Edge from={right(hero.b)} to={left(hero.e)} {...dim} />
      <Edge from={right(hero.c)} to={left(hero.f)} {...dim} />
      <Edge from={right(hero.e)} to={left(hero.g)} {...dim} />
      <Edge from={right(hero.a)} to={left(hero.d)} {...lit} />
      <Edge from={right(hero.b)} to={left(hero.d)} {...lit} />
      <Edge from={right(hero.d)} to={left(hero.f)} {...lit} />
      <Edge from={right(hero.d)} to={left(hero.g)} {...lit} />
      <Folder box={hero.a} title={0.55} roles={[["page", 5], ["layout", 2], ["route-ui", 1]]} />
      <Folder box={hero.b} title={0.4} roles={[["api", 4], ["server-action", 2]]} />
      <Folder box={hero.c} title={0.7} roles={[["client-component", 3], ["component", 4]]} dim />
      <Folder box={hero.d} title={0.62} roles={[["component", 6], ["hook", 2], ["client-component", 2]]} selected />
      <Folder box={hero.e} title={0.35} roles={[["util", 4], ["config", 1]]} dim />
      <Folder box={hero.f} title={0.45} roles={[["hook", 3]]} />
      <Folder box={hero.g} title={0.6} roles={[["util", 5], ["component", 1]]} />
    </svg>
  );
}

/* ------------------------------------------------------- an open folder */

const SIDE_W = 128;
const PANEL = { x: 196, y: 36, w: 184, header: 46, row: 26 };
const PANEL_ROWS: readonly { role: RoleId; title: number }[] = [
  { role: "page", title: 0.5 },
  { role: "page", title: 0.38 },
  { role: "layout", title: 0.62 },
  { role: "component", title: 0.44 },
  { role: "client-component", title: 0.7 },
  { role: "component", title: 0.52 },
  { role: "hook", title: 0.34 },
  { role: "util", title: 0.58 },
  { role: "config", title: 0.4 },
];
const SELECTED_ROW = 4;

/** An opened folder with one file selected: green lines from what imports it, amber to what it imports. */
export function OpenFolder() {
  const grid = useId();
  const panelH = PANEL.header + PANEL_ROWS.length * PANEL.row + 6;
  const rowY = (i: number) => PANEL.y + PANEL.header + i * PANEL.row;
  const selectedMid = rowY(SELECTED_ROW) + PANEL.row / 2;
  const importers: Box[] = [
    { x: 20, y: 64, w: SIDE_W, h: FOLDER_H },
    { x: 20, y: 252, w: SIDE_W, h: FOLDER_H },
  ];
  const imported: Box[] = [
    { x: 428, y: 52, w: SIDE_W, h: FOLDER_H },
    { x: 428, y: 168, w: SIDE_W, h: FOLDER_H },
    { x: 428, y: 284, w: SIDE_W, h: FOLDER_H },
  ];
  return (
    <svg viewBox="0 0 576 400" className="block h-auto w-full" role="img" aria-label="An opened folder showing its files as rows. One file is selected: green lines come in from the folders that import it, amber lines go out to the folders it imports.">
      <DotGrid id={grid} />
      {importers.map((box, i) => (
        <Edge key={i} from={right(box)} to={[PANEL.x, selectedMid]} stroke="var(--edge-in)" opacity={EDGE_LIT} width={1.75} />
      ))}
      {imported.map((box, i) => (
        <Edge key={i} from={[PANEL.x + PANEL.w, selectedMid]} to={left(box)} stroke="var(--edge-out)" opacity={EDGE_LIT} width={1.75} />
      ))}
      <Folder box={importers[0]} title={0.6} roles={[["page", 3], ["layout", 1]]} />
      <Folder box={importers[1]} title={0.42} roles={[["api", 2], ["server-action", 1]]} />
      <Folder box={imported[0]} title={0.5} roles={[["hook", 4]]} />
      <Folder box={imported[1]} title={0.66} roles={[["component", 5], ["client-component", 1]]} />
      <Folder box={imported[2]} title={0.36} roles={[["util", 3], ["config", 1]]} />

      <g>
        <rect x={PANEL.x} y={PANEL.y} width={PANEL.w} height={panelH} rx={8} fill="var(--surface)" />
        <path
          d={`M ${PANEL.x} ${PANEL.y + PANEL.header} V ${PANEL.y + 8} a 8 8 0 0 1 8 -8 H ${PANEL.x + PANEL.w - 8} a 8 8 0 0 1 8 8 V ${PANEL.y + PANEL.header} Z`}
          fill="var(--surface-muted)"
        />
        <line x1={PANEL.x} x2={PANEL.x + PANEL.w} y1={PANEL.y + PANEL.header} y2={PANEL.y + PANEL.header} stroke="var(--border)" />
        <rect x={PANEL.x + 12} y={PANEL.y + 13} width={92} height={7} rx={3.5} fill="var(--fg)" opacity={0.8} />
        <rect x={PANEL.x + 12} y={PANEL.y + 27} width={34} height={5} rx={2.5} fill="var(--fg-muted)" opacity={0.5} />
        {PANEL_ROWS.map(({ role, title }, i) => {
          const y = rowY(i);
          const selected = i === SELECTED_ROW;
          return (
            <g key={i} opacity={selected ? 1 : DIM_NODE}>
              {selected && <rect x={PANEL.x + 1} y={y} width={PANEL.w - 2} height={PANEL.row} fill="var(--accent)" opacity={0.12} />}
              <circle cx={PANEL.x + 16} cy={y + PANEL.row / 2} r={3} fill={ROLES[role].color} />
              <rect x={PANEL.x + 26} y={y + PANEL.row / 2 - 3} width={(PANEL.w - 40) * title} height={6} rx={3} fill="var(--fg)" opacity={0.7} />
            </g>
          );
        })}
        <rect x={PANEL.x} y={PANEL.y} width={PANEL.w} height={panelH} rx={8} fill="none" stroke="var(--fg-muted)" strokeOpacity={0.5} />
      </g>
    </svg>
  );
}

/* ------------------------------------------------ an unresolved import */

/** Two imports the parser resolved, drawn; a third it couldn't, left as an outline with nothing joining it. */
export function UnresolvedImport() {
  const grid = useId();
  const source: Box = { x: 40, y: 136, w: 148, h: FOLDER_H };
  const resolved: Box[] = [
    { x: 332, y: 40, w: 148, h: FOLDER_H },
    { x: 332, y: 136, w: 148, h: FOLDER_H },
  ];
  const guess: Box = { x: 332, y: 232, w: 148, h: FOLDER_H };
  return (
    <svg viewBox="0 0 520 320" className="block h-auto w-full" role="img" aria-label="A folder with lines to the two folders it imports. A third import couldn't be resolved, so the folder it might have meant is only an outline, with no line to it.">
      <DotGrid id={grid} />
      {resolved.map((box, i) => (
        <Edge key={i} from={right(source)} to={left(box)} opacity={0.6} width={1.5} />
      ))}
      <Folder box={source} title={0.58} roles={[["service", 3], ["util", 1]]} />
      <Folder box={resolved[0]} title={0.44} roles={[["repository", 2]]} />
      <Folder box={resolved[1]} title={0.66} roles={[["model", 3], ["config", 1]]} />
      <rect
        x={guess.x}
        y={guess.y}
        width={guess.w}
        height={guess.h}
        rx={8}
        fill="none"
        stroke="var(--fg-muted)"
        strokeOpacity={0.6}
        strokeDasharray="5 4"
      />
    </svg>
  );
}

/** A framework's roles as one bar of equal segments, the way a folder holding one of each would show them. */
export function FrameworkBar({ roles }: { roles: readonly RoleId[] }) {
  return (
    <svg viewBox={`0 0 ${roles.length * 10} 4`} preserveAspectRatio="none" className="block h-1 w-full rounded-full" aria-hidden>
      {roles.map((role, i) => (
        <rect key={role} x={i * 10} y={0} width={10} height={4} fill={ROLES[role].color} />
      ))}
    </svg>
  );
}
