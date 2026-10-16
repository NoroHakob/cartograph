import type { Adapter, RepoContext } from "./adapter";
import { noFrameworkAdapter } from "./none";

export type { Adapter, RepoContext } from "./adapter";

/** Framework adapters, most specific first. The fallback is always last. */
const ADAPTERS: readonly Adapter[] = [noFrameworkAdapter];

export function selectAdapter(repo: RepoContext, adapters: readonly Adapter[] = ADAPTERS): Adapter {
  return adapters.find((adapter) => adapter.detect(repo)) ?? noFrameworkAdapter;
}
