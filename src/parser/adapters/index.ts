import type { Adapter, RepoContext } from "./adapter.ts";
import { noFrameworkAdapter } from "./none.ts";

export type { Adapter, RepoContext } from "./adapter.ts";

/** Framework adapters, most specific first. The fallback is always last. */
const ADAPTERS: readonly Adapter[] = [noFrameworkAdapter];

export function selectAdapter(repo: RepoContext, adapters: readonly Adapter[] = ADAPTERS): Adapter {
  return adapters.find((adapter) => adapter.detect(repo)) ?? noFrameworkAdapter;
}
