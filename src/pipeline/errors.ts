/**
 * A failure the pipeline expected and can explain. Its message is written to
 * the analysis as-is, so it's addressed to the person who submitted the
 * repository. Anything else that's thrown is a bug and is reported as one.
 */
export class PipelineError extends Error {
  override name = "PipelineError";
}
