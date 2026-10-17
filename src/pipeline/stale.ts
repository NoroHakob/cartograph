// Nothing runs analyses on a queue or under a timeout, so a process that dies
// mid-run leaves its row unfinished forever. An unfinished run whose stage
// hasn't moved for this long is treated as abandoned: shown as stale, and
// allowed to be started again. Safe to import from client code.

export const STALE_AFTER_MS = 5 * 60 * 1000;

const UNFINISHED = new Set(["queued", "parsing", "explaining"]);

export function isStale(
  analysis: { status: string; stage_at: string | null; created_at: string },
  now: number = Date.now(),
): boolean {
  if (!UNFINISHED.has(analysis.status)) return false;
  return now - Date.parse(analysis.stage_at ?? analysis.created_at) > STALE_AFTER_MS;
}
