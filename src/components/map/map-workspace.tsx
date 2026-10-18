"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";
import { targetKey, type ExplainResult, type ExplainTarget } from "@/explain/types";
import { categoriesOf } from "@/map/categories";
import type { DetailFile, RepoFacts } from "@/map/detail";
import type { MapEdge } from "@/map/view";
import type { ClassifiableRole, FrameworkId } from "@/parser/taxonomy";
import { CategoryRail } from "./category-rail";
import { DependencyMap, useMapController } from "./dependency-map";
import { DetailPane, type DetailTab, type ReachMode } from "./detail-pane";
import type { ExplainState } from "./explanation";
import { MapShell } from "./map-shell";

interface MapWorkspaceProps {
  framework: FrameworkId;
  files: DetailFile[];
  edges: MapEdge[];
  facts: RepoFacts;
  /** Server actions, bound to the analysis. Absent in the offline preview. */
  explain?: (target: ExplainTarget) => Promise<ExplainResult>;
  reanalyse?: () => Promise<{ error: string }>;
}

/** The rail, the map and its detail pane, sharing one selection, hover and category. */
export function MapWorkspace(props: MapWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <Workspace {...props} />
    </ReactFlowProvider>
  );
}

function Workspace({ framework, files: parsed, edges, facts, explain, reanalyse }: MapWorkspaceProps) {
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
      }
    />
  );
}
