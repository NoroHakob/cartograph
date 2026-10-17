import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { ImportRecord, ParseResult } from "@/parser/types";
import type { RepoSnapshot } from "./github";
import type { Selection } from "./select";

/**
 * Everything in a parse result that isn't stored as a row, kept on the
 * analysis. Files, imports and routes are rows; the map's edges are derived
 * from the internal imports, the same way the parser derives them.
 */
export interface AnalysisSummary {
  version: ParseResult["version"];
  adapter: ParseResult["adapter"];
  modules: ParseResult["modules"];
  excludedFiles: ParseResult["excludedFiles"];
  coverage: ParseResult["coverage"];
  entryPoints: ParseResult["entryPoints"];
  configNotes: ParseResult["configNotes"];
  stats: ParseResult["stats"];
  /** What the select stage left out of the archive, and why. */
  selection: Selection;
}

/**
 * Replaces everything stored for the analysis with `result` and marks it
 * complete, in one transaction (public.store_parse). The parse result goes in
 * as the parser produced it: no file, import or route is added, dropped or
 * renamed on the way.
 */
export async function storeParse(
  db: SupabaseClient<Database>,
  analysisId: string,
  snapshot: RepoSnapshot,
  result: ParseResult,
  selection: Selection,
): Promise<void> {
  const summary: AnalysisSummary = {
    version: result.version,
    adapter: result.adapter,
    modules: result.modules,
    excludedFiles: result.excludedFiles,
    coverage: result.coverage,
    entryPoints: result.entryPoints,
    configNotes: result.configNotes,
    stats: result.stats,
    selection,
  };

  const files = result.files.map((f) => ({
    path: f.path,
    folder: f.folder,
    language: f.language,
    line_count: f.lineCount,
    hash: f.hash,
    module: f.module,
    fan_in: f.fanIn,
    fan_out: f.fanOut,
  }));
  const routes = result.routes.map((r) => ({ file: r.file, path: r.path, kind: r.kind, methods: r.methods }));

  const { error } = await db.rpc("store_parse", {
    p_analysis_id: analysisId,
    p_commit_sha: snapshot.commitSha,
    p_default_branch: snapshot.defaultBranch,
    // The summary is plain data the parser built, so it is valid JSON; the
    // generated Json type just can't see that through the interfaces.
    p_summary: summary as unknown as Json,
    p_files: files,
    p_imports: result.imports.map(importRow),
    p_routes: routes,
  });
  if (error) throw new Error(`store_parse failed: ${error.message}`);
}

function importRow(record: ImportRecord) {
  const r = record.resolution;
  return {
    source: record.source,
    target: r.status === "internal" ? r.target : null,
    specifier: record.specifier,
    kind: record.kind,
    status: r.status,
    reason: r.status === "internal" ? null : r.status === "external" ? r.kind : r.reason,
    detail: r.status === "external" ? (r.packageName ?? null) : r.status === "excluded" ? r.target : r.status === "unresolved" ? (r.detail ?? null) : null,
    installed: r.status === "external" ? (r.installed ?? null) : null,
    type_only: record.typeOnly,
    line: record.line,
  };
}
