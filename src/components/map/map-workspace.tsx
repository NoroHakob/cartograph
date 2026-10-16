"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { useState, type ReactNode } from "react";
import type { DetailFile, RepoFacts } from "@/map/detail";
import type { MapEdge } from "@/map/view";
import { DependencyMap, useMapController } from "./dependency-map";
import { DetailPane, type DetailTab } from "./detail-pane";
import { MapShell } from "./map-shell";

interface MapWorkspaceProps {
  rail: ReactNode;
  files: DetailFile[];
  edges: MapEdge[];
  facts: RepoFacts;
}

/** The map and its detail pane, sharing one selection and one hover. */
export function MapWorkspace(props: MapWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <Workspace {...props} />
    </ReactFlowProvider>
  );
}

function Workspace({ rail, files, edges, facts }: MapWorkspaceProps) {
  const map = useMapController(files, edges, facts.name);
  // Held here, not in the pane, so it survives every change of selection.
  const [tab, setTab] = useState<DetailTab>("structure");
  return (
    <MapShell
      rail={rail}
      canvas={<DependencyMap map={map} />}
      detail={<DetailPane map={map} files={files} edges={edges} facts={facts} tab={tab} onTab={setTab} />}
    />
  );
}
