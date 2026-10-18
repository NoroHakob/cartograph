// What the model is asked, built only from what the parser produced. Every
// path in a prompt is one the parser stored; the model is told to name no
// others, and nothing it says changes the map.
//
// Bump PROMPT_VERSION whenever a prompt's wording or inputs change: it is
// part of every cache key, so old answers to the old question stop matching.

import { CLASSIFIABLE_ROLES, ROLES, UNIDENTIFIED_ROLES, type ClassifiableRole, type RoleId } from "@/parser/taxonomy";
import type { Language } from "@/parser/types";

export const PROMPT_VERSION = 1;

/** A file's source is cut here before it is sent. The cut is said out loud. */
export const MAX_SOURCE_CHARS = 24_000;

export interface Neighbour {
  path: string;
  role: RoleId;
  typeOnly: boolean;
}

/** One file and every one of its neighbours, both ways. */
export interface FileSubject {
  kind: "file";
  path: string;
  language: Language;
  lineCount: number;
  /** The parser's sha256 of the file's bytes: what the cache is keyed on. */
  hash: string;
  /** The adapter's role. */
  role: RoleId;
  /** Files it imports. */
  imports: Neighbour[];
  /** Files that import it. */
  importedBy: Neighbour[];
}

export interface FolderMember {
  path: string;
  role: RoleId;
  lineCount: number;
  hash: string;
  /** Files outside the folder that import this one. */
  importedFromOutside: number;
}

/** Another node on the map, and which of the folder's files it touches. */
export interface FolderLink {
  /** The other node's directory. */
  dir: string;
  /** Distinct files in that node on the far end. */
  files: number;
  /** The folder's own files at this end, sorted. */
  members: string[];
}

/** A folded folder: the node on the map, with every directory merged into it. */
export interface FolderSubject {
  kind: "folder";
  dir: string;
  /** Directories folded into this node, besides its own. */
  merged: string[];
  members: FolderMember[];
  /** Nodes that import something in the folder, most importing files first. */
  importedBy: FolderLink[];
  /** Nodes the folder imports from, most imported files first. */
  imports: FolderLink[];
}

export type Subject = FileSubject | FolderSubject;

export interface Prompt {
  system: string;
  user: string;
}

export const isUnidentified = (role: RoleId) => UNIDENTIFIED_ROLES.includes(role);

/** Every path a subject hands the model: the only paths its answer may name. */
export function handedPaths(subject: Subject): string[] {
  if (subject.kind === "file") return [subject.path, ...subject.imports.map((n) => n.path), ...subject.importedBy.map((n) => n.path)];
  return [
    subject.dir,
    ...subject.merged,
    ...subject.members.map((m) => m.path),
    ...subject.importedBy.map((l) => l.dir),
    ...subject.imports.map((l) => l.dir),
  ].filter((p) => p !== ".");
}

const FORMAT_RULES = `Formatting: you may use exactly three things. Inline code in single backticks for paths and identifiers. Bullets, as lines starting with "- ". Bold with double asterisks, sparingly. Nothing else: no headings, no italics, no links, no tables, no code blocks.`;

const GROUNDING_RULES = `Ground rules:
- Everything you're told about connections between files comes from a parser that read the import statements. It is complete. Do not infer, guess or mention any connection it didn't list, and never say two files are connected unless the lists below say so.
- Name only paths that appear below, written exactly as given. Never invent a path, shorten one, or refer to a file by a name the lists don't contain.
- Write for a developer who is reading a dependency map and has just selected this. Be concrete. No preamble, no closing summary.`;

const ROLE_MEANINGS: Record<ClassifiableRole, string> = {
  service: "business logic that other code calls to get something done",
  repository: "reads and writes stored data: a database, cache, file or remote store",
  model: "describes the shape of data: types, schemas, entities, validators",
  util: "small general-purpose helpers with no particular domain",
  config: "configuration, constants or environment setup",
  component: "a UI component that renders markup",
  hook: "a React hook",
};

function roleName(role: RoleId): string {
  return isUnidentified(role) ? "unidentified" : ROLES[role].name;
}

function neighbourLines(list: readonly Neighbour[], empty: string): string {
  if (list.length === 0) return empty;
  return list.map((n) => `- ${n.path} (${roleName(n.role)}${n.typeOnly ? ", types only" : ""})`).join("\n");
}

/** Whether explaining this file also asks the model for a role. */
export function classifies(subject: FileSubject): boolean {
  return isUnidentified(subject.role);
}

/** The JSON Schema a classifying explanation answers in. */
export const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    explanation: { type: "string", description: "The explanation, following every rule above." },
    role: { type: "string", enum: [...CLASSIFIABLE_ROLES], description: "The one role that best describes the file." },
    rationale: { type: "string", description: "One short sentence: why that role." },
  },
  required: ["explanation", "role", "rationale"],
} as const;

export function filePrompt(subject: FileSubject, source: string | null): Prompt {
  const classify = classifies(subject);
  const system = [
    "You explain one file of a codebase, in the context of the files around it.",
    GROUNDING_RULES,
    "Say what the file does and what part it plays among its neighbours: what it takes from the files it imports, and what the files importing it come to it for. Two or three short paragraphs, under 180 words in all. Bullets only if a list genuinely reads better.",
    FORMAT_RULES,
    classify
      ? `No framework convention identified this file, so also give it one role, chosen only from this list. Pick the closest even if none is perfect; never answer with anything outside it.\n${CLASSIFIABLE_ROLES.map((r) => `- ${r}: ${ROLE_MEANINGS[r]}`).join("\n")}\nAnswer as JSON with the fields explanation, role and rationale.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const shown = source === null ? null : source.length > MAX_SOURCE_CHARS ? source.slice(0, MAX_SOURCE_CHARS) : source;
  const user = [
    `File: ${subject.path}`,
    `Category: ${roleName(subject.role)} · ${subject.lineCount} lines`,
    "",
    `It imports these ${subject.imports.length} files in the repository:`,
    neighbourLines(subject.imports, "(none)"),
    "",
    `These ${subject.importedBy.length} files in the repository import it:`,
    neighbourLines(subject.importedBy, "(none)"),
    "",
    shown === null
      ? "The source couldn't be read, so explain it from its path and neighbours alone, and say so."
      : `Source${shown.length < (source?.length ?? 0) ? ` (first ${MAX_SOURCE_CHARS} characters of ${source!.length}; the rest was cut)` : ""}:\n<source>\n${shown}\n</source>`,
  ].join("\n");
  return { system, user };
}

export function folderPrompt(subject: FolderSubject, repoName: string): Prompt {
  const system = [
    "You explain one folder of a codebase as it appears on a dependency map: a single node that stands for every file in it, including subfolders folded into it.",
    GROUNDING_RULES,
    "Answer two questions about the folder as a whole. What lives here: the kinds of files and what they amount to together. And why so much points at it: what the importing parts of the codebase come here for, judged from which of its files they import. Do not summarise any single file at length; this is about the folder. Two or three short paragraphs, under 180 words in all.",
    FORMAT_RULES,
  ].join("\n\n");

  const name = subject.dir === "." ? `${repoName} (the repository root)` : subject.dir;
  const links = (list: readonly FolderLink[], verb: string) =>
    list.length === 0
      ? "(none)"
      : list.map((l) => `- ${l.dir === "." ? "(repository root)" : l.dir}: ${l.files} file${l.files === 1 ? "" : "s"} there ${verb} ${l.members.join(", ")}`).join("\n");
  const user = [
    `Folder: ${name}`,
    subject.merged.length > 0 ? `Folded into it: ${subject.merged.join(", ")}` : "",
    "",
    `Its ${subject.members.length} files, most imported from outside first (category, lines, files outside that import it):`,
    subject.members.map((m) => `- ${m.path} (${roleName(m.role)}, ${m.lineCount} lines, imported by ${m.importedFromOutside})`).join("\n"),
    "",
    "Other folders on the map that import from it:",
    links(subject.importedBy, "import"),
    "",
    "Folders it imports from:",
    links(subject.imports, "are imported by"),
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
  return { system, user };
}
