"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";
import { targetKey, type ExplainResult, type ExplainTarget } from "@/explain/types";
import { categoriesOf } from "@/map/categories";
import type { DetailFile, RepoFacts } from "@/map/detail";
import type { MapEdge } from "@/map/view";
import type { ClassifiableRole, FrameworkId } from "@/parser/taxonomy";
import { AskPanel, useAskConversation, type AskSelection } from "./ask-panel";
import { CategoryRail } from "./category-rail";
import { DependencyMap, useMapController } from "./dependency-map";
import { DetailPane, type DetailTab, type ReachMode } from "./detail-pane";
import type { ExplainState, PathLinks } from "./explanation";
import { MapShell } from "./map-shell";

interface MapWorkspaceProps {
  framework: FrameworkId;
  files: DetailFile[];
  edges: MapEdge[];
  facts: RepoFacts;
  /** Server actions, bound to the analysis. Absent in the offline preview. */
  explain?: (target: ExplainTarget) => Promise<ExplainResult>;
  reanalyse?: () => Promise<{ error: string }>;
  /** The stored analysis, for Ask. Absent in the offline preview, which has no agent. */
  analysisId?: string;
}

/** The rail, the map and its detail pane, sharing one selection, hover and category. */
export function MapWorkspace(props: MapWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <Workspace {...props} />
    </ReactFlowProvider>
  );
}

function Workspace({ framework, files: parsed, edges, facts, explain, reanalyse, analysisId }: MapWorkspaceProps) {
  // Roles a model gave unidentified files in this session. Stored ones came
  // in with the files; these are merged over them so the map and rail
  // recolour without a reload. Only roles change: never a file or an edge.
  const [suggested, setSuggested] = useState<ReadonlyMap<string, { role: ClassifiableRole; model: string }>>(() => new Map());
  const files = useMemo(
    () => (suggested.size === 0 ? parsed : parsed.map((f) => (suggested.has(f.path) ? { ...f, role: suggested.get(f.path)!.role, roleBy: suggested.get(f.path)!.model } : f))),
    [parsed, suggested],
  );
  const categories = useMemo(() => categoriesOf(framework, files), [framework, files]);

  const map = useMapController(files, edges, facts.name);
  // Held here, not in the pane, so both survive every change of selection.
  const [tab, setTab] = useState<DetailTab>("structure");
  const [reachMode, setReachMode] = useState<ReachMode | null>(null);
  // Explanations by target: one fetched stays in the pane when the selection
  // moves away and comes back, without another click.
  const [explanations, setExplanations] = useState<ReadonlyMap<string, ExplainState>>(() => new Map());

  // Ask is a mode of the whole pane, not a tab: a question about the
  // repository isn't about the selection, and a tab would vanish with it.
  // Leaving Ask shows whatever is selected; the conversation is kept.
  const [asking, setAsking] = useState(false);
  const conversation = useAskConversation(analysisId ?? "");
  const askSelection = useMemo<AskSelection | null>(() => {
    const { selection, view } = map;
    if (selection === null) return null;
    if (selection.kind === "row") return { kind: "file", path: selection.path };
    const node = view.nodes.find((n) => n.id === selection.id);
    return node ? { kind: "folder", path: node.dir } : null;
  }, [map]);
  const folders = useMemo(() => new Set(map.fold.groups.map((g) => g.dir)), [map.fold]);
  const fileSet = useMemo(() => new Set(files.map((f) => f.path)), [files]);
  const links = useMemo<PathLinks>(
    () => ({ files: fileSet, folders, onFile: map.focusFile, onFolder: map.focusFolder, onHover: map.setHover }),
    [fileSet, folders, map.focusFile, map.focusFolder, map.setHover],
  );

  const onExplain = useCallback(
    async (target: ExplainTarget) => {
      if (!explain) return;
      const key = targetKey(target);
      const update = (next: (current: ExplainState | undefined) => ExplainState) =>
        setExplanations((all) => new Map(all).set(key, next(all.get(key))));
      const previousOf = (current: ExplainState | undefined) => (current?.status === "done" ? current.explanation : current?.previous);

      update((current) => ({ status: "loading", previous: previousOf(current) }));
      let result: ExplainResult;
      try {
        result = await explain(target);
      } catch {
        result = { ok: false, error: "The server couldn't be reached." };
      }
      if (!result.ok) {
        const error = result.error;
        update((current) => ({ status: "error", message: error, previous: previousOf(current) }));
        return;
      }
      const { explanation } = result;
      update(() => ({ status: "done", explanation }));
      if (explanation.role && target.kind === "file") {
        const role = explanation.role.role;
        setSuggested((all) => new Map(all).set(target.path, { role, model: explanation.model }));
      }
    },
    [explain],
  );

  return (
    <MapShell
      rail={<CategoryRail framework={facts.framework} categories={categories} active={map.category} onSelect={map.setCategory} />}
      canvas={<DependencyMap map={map} files={files} />}
      detail={
        <div className="flex h-full flex-col">
          {analysisId && <PaneMode asking={asking} onAsking={setAsking} />}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {analysisId && asking ? (
              <AskPanel repository={facts.name} conversation={conversation} selection={askSelection} links={links} />
            ) : (
              <DetailPane
                map={map}
                files={files}
                edges={edges}
                facts={facts}
                tab={tab}
                onTab={setTab}
                reachMode={reachMode}
                onReachMode={setReachMode}
                explanations={explanations}
                onExplain={explain && onExplain}
                onReanalyse={reanalyse}
              />
            )}
          </div>
        </div>
      }
    />
  );
}

/** Which pane is showing: the details of the selection, or Ask. Above both, so it never moves. */
function PaneMode({ asking, onAsking }: { asking: boolean; onAsking: (asking: boolean) => void }) {
  return (
    <div role="radiogroup" aria-label="Pane" className="flex shrink-0 gap-1 border-b border-border p-1.5">
      {(
        [
          [false, "Details"],
          [true, "Ask"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={label}
          type="button"
          role="radio"
          aria-checked={asking === value}
          onClick={() => onAsking(value)}
          className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${asking === value ? "bg-surface-muted text-fg" : "text-fg-muted hover:text-fg"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
