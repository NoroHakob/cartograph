// Reading public repositories from GitHub. Every request is anonymous: no
// token is sent, so no repository scope is ever asked for and nothing is
// stored. The cost is GitHub's anonymous rate limit (60 API requests an hour
// per IP): submitting a repository uses one, and a run three more.

import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PipelineError } from "./errors";

export interface RepoRef {
  owner: string;
  name: string;
}

export interface RepoSnapshot extends RepoRef {
  defaultBranch: string;
  /** The full 40-character commit the archive is pinned to. */
  commitSha: string;
}

/** The archive is refused past this, before it is ever unpacked. */
export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;

// Every call here takes an AbortSignal, and none is optional: a request
// without a deadline can stall forever with nothing recorded. Callers bound
// them with one of these.

/** A lookup someone is waiting on: one small JSON response. */
export const LOOKUP_TIMEOUT_MS = 30 * 1000;
/** A whole fetch, lookup and download together, up to MAX_ARCHIVE_BYTES. */
export const FETCH_TIMEOUT_MS = 5 * 60 * 1000;

const API = "https://api.github.com";
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Reads "owner/name" out of what someone pasted: a github.com URL (with or
 * without scheme, ".git", or a trailing /tree/... path), an SSH remote, or a
 * bare "owner/name". Returns null for anything else.
 */
export function parseRepoUrl(input: string): RepoRef | null {
  let rest = input.trim();
  const ssh = /^git@github\.com:(.+)$/i.exec(rest);
  if (ssh) rest = ssh[1];
  else {
    rest = rest.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "");
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rest)) return null; // another host
  }
  const [owner, rawName] = rest.split(/[/?#]/);
  const name = rawName?.replace(/\.git$/i, "");
  if (!owner || !name || !OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..") return null;
  return { owner, name };
}

/**
 * The repository's canonical owner and name (GitHub follows renames and
 * ignores case; we don't want two projects for one repository) and its
 * default branch. One API request. Throws a PipelineError if it isn't public.
 */
export async function lookupRepository(
  ref: RepoRef,
  signal: AbortSignal,
): Promise<RepoRef & { defaultBranch: string }> {
  const repoPath = `${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`;
  const repo = await request(`${API}/repos/${repoPath}`, "application/vnd.github+json", ref, signal);
  const body = (await repo.json()) as { full_name?: unknown; default_branch?: unknown; private?: unknown };
  if (body.private === true) throw notFound(ref); // unreachable anonymously, but never parse one
  if (typeof body.full_name !== "string" || typeof body.default_branch !== "string") {
    throw new PipelineError(`GitHub returned an unexpected response for ${ref.owner}/${ref.name}.`);
  }
  const [owner, name] = body.full_name.split("/");
  return { owner, name, defaultBranch: body.default_branch };
}

/**
 * lookupRepository, plus the commit the default branch points at right now.
 */
export async function resolveSnapshot(ref: RepoRef, signal: AbortSignal): Promise<RepoSnapshot> {
  const { owner, name, defaultBranch: branch } = await lookupRepository(ref, signal);
  const commit = await request(
    `${API}/repos/${owner}/${name}/commits/${encodeURIComponent(branch)}`,
    "application/vnd.github.sha",
    { owner, name },
    signal,
  );
  const commitSha = (await commit.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new PipelineError(`GitHub didn't return a commit for ${owner}/${name}@${branch}.`);
  }
  return { owner, name, defaultBranch: branch, commitSha };
}

/**
 * Downloads the gzipped tarball of exactly `snapshot.commitSha` to `file`.
 * Pinned to the commit, not the branch, so what's parsed is what's recorded
 * even if someone pushes in between.
 */
export async function downloadArchive(snapshot: RepoSnapshot, file: string, signal: AbortSignal): Promise<number> {
  const url = `${API}/repos/${snapshot.owner}/${snapshot.name}/tarball/${snapshot.commitSha}`;
  const response = await request(url, "application/vnd.github+json", snapshot, signal);
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_ARCHIVE_BYTES) throw tooLarge(snapshot);
  if (!response.body) throw new PipelineError("GitHub sent an empty archive.");

  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      done(bytes > MAX_ARCHIVE_BYTES ? tooLarge(snapshot) : null, chunk);
    },
  });
  // The DOM and Node ReadableStream types differ only nominally here.
  await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), limit, createWriteStream(file), {
    signal,
  });
  return bytes;
}

async function request(url: string, accept: string, ref: RepoRef, signal: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept, "user-agent": "cartograph", "x-github-api-version": "2022-11-28" },
      redirect: "follow",
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new PipelineError(`Couldn't reach GitHub: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.ok) return response;

  if (response.status === 404) throw notFound(ref);
  if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const when = Number.isFinite(reset) && reset > 0 ? ` after ${new Date(reset * 1000).toISOString().slice(11, 16)} UTC` : " later";
    throw new PipelineError(`GitHub's limit for anonymous requests has been reached. Try again${when}.`);
  }
  if (response.status === 409) throw new PipelineError(`${ref.owner}/${ref.name} is empty: it has no commits to parse.`);
  throw new PipelineError(`GitHub answered ${response.status} ${response.statusText} for ${ref.owner}/${ref.name}.`);
}

function notFound(ref: RepoRef): PipelineError {
  return new PipelineError(`${ref.owner}/${ref.name} wasn't found. Only public repositories can be analysed.`);
}

function tooLarge(ref: RepoRef): PipelineError {
  return new PipelineError(`${ref.owner}/${ref.name} is over ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB as an archive, which is more than this can parse.`);
}

/**
 * The commit `branch` points at right now. One API request, for checking
 * whether an analysis is still current without starting a run.
 */
export async function headCommit(ref: RepoRef, branch: string, signal: AbortSignal): Promise<string> {
  const response = await request(
    `${API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/commits/${encodeURIComponent(branch)}`,
    "application/vnd.github.sha",
    ref,
    signal,
  );
  const sha = (await response.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new PipelineError(`GitHub didn't return a commit for ${ref.owner}/${ref.name}@${branch}.`);
  return sha;
}

/** The parser's own limit (MAX_FILE_BYTES): no file past it is ever a node. */
const MAX_RAW_BYTES = 1024 * 1024;

/**
 * One file's bytes at exactly `commitSha`, or null when the file isn't there
 * at that commit. Served by raw.githubusercontent.com, which doesn't count
 * against the API's anonymous limit, and immutable for a full commit sha.
 */
export async function fetchRawFile(ref: RepoRef, commitSha: string, filePath: string, signal: AbortSignal): Promise<Buffer | null> {
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/${commitSha}/${filePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { "user-agent": "cartograph" }, signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new PipelineError(`Couldn't reach GitHub: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new PipelineError(`GitHub answered ${response.status} for ${filePath}.`);
  if (Number(response.headers.get("content-length")) > MAX_RAW_BYTES) throw new PipelineError(`${filePath} is too large to read.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RAW_BYTES) throw new PipelineError(`${filePath} is too large to read.`);
  return bytes;
}
