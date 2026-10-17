import type { Adapter, RepoContext } from "./adapter.ts";
import { nestjsAdapter } from "./nestjs.ts";
import { nextjsAdapter } from "./nextjs.ts";
import { noFrameworkAdapter } from "./none.ts";
import { reactAdapter } from "./react.ts";

export type { Adapter, RepoContext } from "./adapter.ts";

/**
 * Framework adapters in detection order; the first that matches wins. Next.js
 * comes before React because every Next.js app also depends on React. The
 * fallback is always last and always matches.
 */
export const ADAPTERS: readonly Adapter[] = [nextjsAdapter, nestjsAdapter, reactAdapter, noFrameworkAdapter];

export function selectAdapter(repo: RepoContext, adapters: readonly Adapter[] = ADAPTERS): Adapter {
  return adapters.find((adapter) => adapter.detect(repo)) ?? noFrameworkAdapter;
}
