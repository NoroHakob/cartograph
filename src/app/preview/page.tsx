import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapWorkspace } from "@/components/map/map-workspace";
import type { RepoFacts } from "@/map/detail";
import { FIXTURE_REPOSITORY, loadFixture } from "./fixture";

export const metadata: Metadata = {
  title: "Preview · Cartograph",
};

// Renders the map interface without an account, a database or a network, so
// it can be built against checked-in parser output. Development only: the
// proxy lets this route through without a session.
export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const result = loadFixture();
  // The client gets only the fields the map and the detail pane read, in the
  // parser's own shape. Everything the pane shows is in this payload, so
  // selecting something never goes back to the server.
  const files = result.files.map(({ path, folder, language, role, lineCount, fanIn, fanOut }) => ({ path, folder, language, role, lineCount, fanIn, fanOut }));
  const edges = result.edges.map(({ source, target, typeOnly }) => ({ source, target, typeOnly }));
  const facts: RepoFacts = {
    name: FIXTURE_REPOSITORY.split("/").pop()!,
    framework: result.adapter.name,
    importCount: result.imports.length,
    routes: result.routes,
    entryPoints: result.entryPoints.flatMap(({ path, origin }) => (path === null ? [] : [{ path, origin }])),
  };

  return (
    <div className="h-dvh">
      <MapWorkspace framework={result.adapter.id} files={files} edges={edges} facts={facts} />
    </div>
  );
}
