// The select stage: unpacks the archive into a directory the parser can walk,
// writing only what the parser reads.
//
// The parser reads the contents of three kinds of file: TS/JS sources, JSON
// (package.json, and tsconfigs plus whatever they extend), and .gitignore.
// Every other file it only checks for existence, so an import of "./x.css"
// classifies as a non-source file rather than a missing one. Those are written
// empty. The parse result is the same as on a full checkout, without writing
// out images, fixtures and vendored binaries.
//
// The archive is untrusted. Links are never written, and neither is any path
// that could land outside the destination or that this filesystem can't hold
// faithfully. Each one is recorded, so a gap in the map has a named reason.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { list, type ReadEntry } from "tar";
import { languageOf } from "@/parser/walk";
import { PipelineError } from "./errors";

export type SkipReason =
  | "link" // symlinks and hard links: the parser skips them too
  | "unsafe-path" // absolute, "..", or a name this filesystem can't represent
  | "case-collision" // differs from another path only by case, on a case-insensitive disk
  | "unwritable"; // the filesystem refused it

export interface Selection {
  /** Regular files and links in the archive. */
  entries: number;
  /** Written with their contents. */
  kept: number;
  /** Written empty: the parser only checks they exist. */
  placeholders: number;
  skipped: { count: number; examples: { path: string; reason: SkipReason }[] };
}

/** Contents written to disk, summed. Past this the repository is refused. */
export const MAX_KEPT_BYTES = 512 * 1024 * 1024;
/** Files in the archive. Past this the repository is refused. */
export const MAX_ENTRIES = 200_000;
const SKIP_EXAMPLES = 50;

const FILE_TYPES = new Set(["File", "OldFile", "ContiguousFile"]);
const LINK_TYPES = new Set(["SymbolicLink", "Link"]);
const WINDOWS = process.platform === "win32";
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const CASE_INSENSITIVE = WINDOWS || process.platform === "darwin";

/** Unpacks `archive` (a GitHub tarball) into `dest`, which must exist and be empty. */
export async function selectFromArchive(archive: string, dest: string): Promise<Selection> {
  const selection: Selection = { entries: 0, kept: 0, placeholders: 0, skipped: { count: 0, examples: [] } };
  const seen = new Set<string>();
  let keptBytes = 0;
  let failure: unknown;

  const skip = (rel: string, reason: SkipReason) => {
    selection.skipped.count++;
    if (selection.skipped.examples.length < SKIP_EXAMPLES) selection.skipped.examples.push({ path: rel, reason });
  };

  const onReadEntry = (entry: ReadEntry) => {
    // GitHub wraps everything in one "<owner>-<repo>-<sha>/" directory.
    const rel = entry.path.split("/").slice(1).join("/").replace(/\/+$/, "");
    const isFile = FILE_TYPES.has(entry.type);
    if (failure || !rel || (!isFile && !LINK_TYPES.has(entry.type))) return entry.resume();

    selection.entries++;
    if (selection.entries > MAX_ENTRIES) {
      failure ??= new PipelineError(`The repository has more than ${MAX_ENTRIES.toLocaleString("en")} files, which is more than this can parse.`);
      return entry.resume();
    }
    const key = CASE_INSENSITIVE ? rel.toLowerCase() : rel;
    const reason: SkipReason | undefined = !isFile ? "link" : unsafe(rel) ? "unsafe-path" : seen.has(key) ? "case-collision" : undefined;
    if (reason) {
      skip(rel, reason);
      return entry.resume();
    }
    seen.add(key);

    const abs = path.join(dest, ...rel.split("/"));
    const write = (contents: Buffer) => {
      try {
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, contents, { flag: "wx" });
      } catch {
        skip(rel, "unwritable");
        return false;
      }
      return true;
    };

    if (!readByParser(rel)) {
      if (write(Buffer.alloc(0))) selection.placeholders++;
      return entry.resume();
    }

    keptBytes += entry.size;
    if (keptBytes > MAX_KEPT_BYTES) {
      failure ??= new PipelineError(`The repository's source is over ${MAX_KEPT_BYTES / 1024 / 1024} MB, which is more than this can parse.`);
      return entry.resume();
    }
    const chunks: Buffer[] = [];
    entry.on("data", (chunk: Buffer) => chunks.push(chunk));
    entry.on("end", () => {
      if (write(Buffer.concat(chunks))) selection.kept++;
    });
  };

  try {
    await list({ file: archive, strict: true, onReadEntry });
  } catch (error) {
    throw new PipelineError(`The archive from GitHub couldn't be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (failure) throw failure;
  if (selection.entries === 0) throw new PipelineError("The archive from GitHub contained no files.");
  return selection;
}

function readByParser(rel: string): boolean {
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  return languageOf(rel) !== undefined || name.endsWith(".json") || name === ".gitignore";
}

function unsafe(rel: string): boolean {
  if (rel.startsWith("/") || rel.includes("\\") || rel.includes("\u0000")) return true;
  return rel.split("/").some(
    (part) =>
      part === "" ||
      part === "." ||
      part === ".." ||
      (WINDOWS && (/[<>:"|?*\u0001-\u001f]/.test(part) || /[. ]$/.test(part) || WINDOWS_RESERVED.test(part))),
  );
}
