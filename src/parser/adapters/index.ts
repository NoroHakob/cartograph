import type { Adapter, RepoContext } from "./adapter.ts";
import { expressAdapter } from "./express.ts";
import { nestjsAdapter } from "./nestjs.ts";
import { nextjsAdapter } from "./nextjs.ts";
import { noFrameworkAdapter } from "./none.ts";
import { reactAdapter } from "./react.ts";

export type { Adapter, RepoContext } from "./adapter.ts";

/**
 * Framework adapters in detection order; the first that matches wins. Next.js
 * comes before React because every Next.js app also depends on React. NestJS
 * comes before Express because a Nest app may list Express, which it runs on.
 * React comes before Express because a front end that ships its own small
 * Express server is still a front end; its components need their roles. The
 * fallback is always last and always matches.
 */
export const ADAPTERS: readonly Adapter[] = [nextjsAdapter, nestjsAdapter, reactAdapter, expressAdapter, noFrameworkAdapter];

export function selectAdapter(repo: RepoContext, adapters: readonly Adapter[] = ADAPTERS): Adapter {
  return adapters.find((adapter) => adapter.detect(repo)) ?? noFrameworkAdapter;
}
