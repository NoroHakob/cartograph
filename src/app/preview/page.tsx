import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryRail } from "@/components/map/category-rail";
import { DependencyMap } from "@/components/map/dependency-map";
import { MapShell } from "@/components/map/map-shell";
import { categoriesOf } from "@/map/categories";
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
  // The client gets only the fields the map reads, in the parser's own shape.
  const files = result.files.map(({ path, folder, language, fanIn, fanOut }) => ({ path, folder, language, fanIn, fanOut }));
  const edges = result.edges.map(({ source, target, typeOnly }) => ({ source, target, typeOnly }));
  const rootName = FIXTURE_REPOSITORY.split("/").pop()!;

  return (
    <MapShell
      rail={<CategoryRail categories={categoriesOf(result.files)} />}
      canvas={<DependencyMap files={files} edges={edges} rootName={rootName} />}
    />
  );
}
