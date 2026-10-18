import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { paged } from "@/lib/supabase/paged";
import { fold } from "@/map/fold";
import { isRoleId, type RoleId } from "@/parser/taxonomy";
import type { Language } from "@/parser/types";
import type { FileSubject, FolderLink, FolderSubject, Neighbour } from "./prompts";

// The subject of an explanation, read from stored parser output and nothing
// else. The browser says which file or folder; the server works out what
// surrounds it, so no neighbour the model sees ever came from the client.

type Db = SupabaseClient<Database>;

const role = (value: string | null): RoleId => (isRoleId(value) ? value : "source");
const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A file and all of its neighbours. Null when the analysis has no such file. */
export async function loadFileSubject(db: Db, analysisId: string, path: string): Promise<{ subject: FileSubject; fileId: string } | null> {
  const { data: file, error } = await db
    .from("files")
    .select("id, path, language, line_count, hash, role")
    .eq("analysis_id", analysisId)
    .eq("path", path)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!file) return null;

  const internal = () => db.from("edges").select("id, source_file_id, target_file_id, type_only").eq("analysis_id", analysisId).eq("status", "internal");
  const [out, into] = await Promise.all([
    paged((from, to) => internal().eq("source_file_id", file.id).order("id").range(from, to)),
    paged((from, to) => internal().eq("target_file_id", file.id).order("id").range(from, to)),
  ]);

  const ids = [...new Set([...out.map((e) => e.target_file_id!), ...into.map((e) => e.source_file_id)])];
  const neighbours = new Map<string, { path: string; role: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: rowsError } = await db.from("files").select("id, path, role").in("id", ids.slice(i, i + 200));
    if (rowsError) throw new Error(rowsError.message);
    for (const row of data ?? []) neighbours.set(row.id, row);
  }

  // One entry per neighbour, type-only only when every import of the pair is:
  // the map's own rule for collapsing imports into an edge.
  const collapse = (rows: readonly { other: string; typeOnly: boolean }[]): Neighbour[] => {
    const pairs = new Map<string, Neighbour>();
    for (const { other, typeOnly } of rows) {
      const found = neighbours.get(other);
      if (!found) continue;
      const existing = pairs.get(found.path);
      if (existing) existing.typeOnly &&= typeOnly;
      else pairs.set(found.path, { path: found.path, role: role(found.role), typeOnly });
    }
    return [...pairs.values()].sort((a, b) => byPath(a.path, b.path));
  };

  return {
    fileId: file.id,
    subject: {
      kind: "file",
      path: file.path,
      // The column's check constraint holds it to the parser's languages.
      language: file.language as Language,
      lineCount: file.line_count,
      hash: file.hash,
      role: role(file.role),
      imports: collapse(out.map((e) => ({ other: e.target_file_id!, typeOnly: e.type_only }))),
      importedBy: collapse(into.map((e) => ({ other: e.source_file_id, typeOnly: e.type_only }))),
    },
  };
}

/**
 * A folded folder, exactly as the map folds it: the same fold over the same
 * stored files. Null when `dir` isn't a node of that fold.
 */
export async function loadFolderSubject(db: Db, analysisId: string, dir: string): Promise<FolderSubject | null> {
  const [files, edges] = await Promise.all([
    paged((from, to) =>
      db.from("files").select("id, path, folder, role, line_count, hash").eq("analysis_id", analysisId).order("id").range(from, to),
    ),
    paged((from, to) =>
      db
        .from("edges")
        .select("id, source_file_id, target_file_id")
        .eq("analysis_id", analysisId)
        .eq("status", "internal")
        .order("id")
        .range(from, to),
    ),
  ]);

  const folded = fold(files);
  const group = folded.groups.find((g) => g.dir === dir);
  if (!group) return null;
  const members = new Set(group.files);
  const pathById = new Map(files.map((f) => [f.id, f.path]));

  const fromOutside = new Map<string, Set<string>>();
  // Other node → (files of theirs, our files) for each direction.
  const into = new Map<string, { files: Set<string>; members: Set<string> }>();
  const out = new Map<string, { files: Set<string>; members: Set<string> }>();
  const add = (index: typeof into, node: string, file: string, member: string) => {
    const entry = index.get(node) ?? { files: new Set(), members: new Set() };
    entry.files.add(file);
    entry.members.add(member);
    index.set(node, entry);
  };
  for (const edge of edges) {
    const source = pathById.get(edge.source_file_id);
    const target = edge.target_file_id ? pathById.get(edge.target_file_id) : undefined;
    if (!source || !target) continue;
    const sourceIn = members.has(source);
    const targetIn = members.has(target);
    if (sourceIn === targetIn) continue; // inside the folder, or nothing to do with it
    if (targetIn) {
      fromOutside.set(target, (fromOutside.get(target) ?? new Set()).add(source));
      add(into, folded.groupOf.get(source)!, source, target);
    } else {
      add(out, folded.groupOf.get(target)!, target, source);
    }
  }

  const links = (index: typeof into): FolderLink[] =>
    [...index]
      .map(([node, { files, members }]) => ({ dir: node, files: files.size, members: [...members].sort(byPath) }))
      .sort((a, b) => b.files - a.files || byPath(a.dir, b.dir));

  const merged = [...new Set(files.filter((f) => members.has(f.path)).map((f) => f.folder))].filter((d) => d !== dir).sort(byPath);
  return {
    kind: "folder",
    dir,
    merged,
    members: files
      .filter((f) => members.has(f.path))
      .map((f) => ({ path: f.path, role: role(f.role), lineCount: f.line_count, hash: f.hash, importedFromOutside: fromOutside.get(f.path)?.size ?? 0 }))
      .sort((a, b) => b.importedFromOutside - a.importedFromOutside || byPath(a.path, b.path)),
    importedBy: links(into),
    imports: links(out),
  };
}
