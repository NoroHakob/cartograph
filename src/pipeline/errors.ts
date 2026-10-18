/**
 * A failure the pipeline expected and can explain. Its message is written to
 * the analysis as-is, so it's addressed to the person who submitted the
 * repository. Anything else that's thrown is a bug and is reported as one.
 */
export class PipelineError extends Error {
  override name = "PipelineError";
}

/**
 * The run no longer holds its analysis: it went stale and another run claimed
 * it. Nothing more may be written for this run, not even its failure, because
 * the row now belongs to the run that took it over.
 */
export class SupersededError extends Error {
  override name = "SupersededError";
}

/**
 * Whether an AbortSignal.timeout fired. fetch rejects with the signal's own
 * TimeoutError, but a stream pipeline wraps it: it rejects with an AbortError
 * whose cause is the TimeoutError. A download that stalls mid-body takes the
 * second path.
 */
export function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError") return true;
  return error.name === "AbortError" && error.cause instanceof Error && error.cause.name === "TimeoutError";
}
