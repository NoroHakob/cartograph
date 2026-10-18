import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MapWorkspace } from "@/components/map/map-workspace";
import { loadExplorer } from "../explorer-data";
import { explainTarget, reanalyse } from "./actions";

export const metadata: Metadata = {
  title: "Map · Cartograph",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Below the app header (h-14), the map takes the rest of the screen.
const FRAME = "flex h-[calc(100dvh-3.5rem)] flex-col";

export default function MapPage({ params }: PageProps<"/o/[slug]/analyses/[id]/map">) {
  return (
    <Suspense fallback={<div className={`${FRAME} animate-pulse bg-surface-muted`} aria-hidden />}>
      <StoredMap params={params} />
    </Suspense>
  );
}

async function StoredMap({ params }: { params: PageProps<"/o/[slug]/analyses/[id]/map">["params"] }) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const explorer = await loadExplorer(id);
  // Not complete, or not this organization's: the analysis page says which.
  if (!explorer) notFound();

  return (
    <div className={FRAME}>
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-2 text-sm">
        <Link href={`/o/${slug}/analyses/${id}`} className="text-fg-muted underline-offset-4 hover:text-fg hover:underline">
          ← {explorer.repo.owner}/{explorer.repo.name}
        </Link>
        <span className="font-mono text-xs text-fg-muted">{explorer.repo.commitSha.slice(0, 7)}</span>
        {!explorer.rolesStored && (
          <span className="ml-auto text-xs text-fg-muted">Stored before categories were recorded. Re-run the analysis to see them.</span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <MapWorkspace
          framework={explorer.framework}
          files={explorer.files}
          edges={explorer.edges}
          facts={explorer.facts}
          explain={explainTarget.bind(null, id)}
          reanalyse={reanalyse.bind(null, id)}
        />
      </div>
    </div>
  );
}
