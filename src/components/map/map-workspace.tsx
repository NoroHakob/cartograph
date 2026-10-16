"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { useState } from "react";
import type { FileCategory } from "@/map/categories";
import type { DetailFile, RepoFacts } from "@/map/detail";
import type { MapEdge } from "@/map/view";
import { CategoryRail } from "./category-rail";
import { DependencyMap, useMapController } from "./dependency-map";
import { DetailPane, type DetailTab, type ReachMode } from "./detail-pane";
import { MapShell } from "./map-shell";

interface MapWorkspaceProps {
  categories: FileCategory[];
  files: DetailFile[];
  edges: MapEdge[];
  facts: RepoFacts;
}

/** The rail, the map and its detail pane, sharing one selection, hover and category. */
export function MapWorkspace(props: MapWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <Workspace {...props} />
    </ReactFlowProvider>
  );
}

function Workspace({ categories, files, edges, facts }: MapWorkspaceProps) {
  const map = useMapController(files, edges, facts.name);
  // Held here, not in the pane, so both survive every change of selection.
  const [tab, setTab] = useState<DetailTab>("structure");
  const [reachMode, setReachMode] = useState<ReachMode | null>(null);
  return (
    <MapShell
      rail={<CategoryRail categories={categories} active={map.category} onSelect={map.setCategory} />}
      canvas={<DependencyMap map={map} files={files} />}
      detail={
        <DetailPane map={map} files={files} edges={edges} facts={facts} tab={tab} onTab={setTab} reachMode={reachMode} onReachMode={setReachMode} />
      }
    />
  );
}
