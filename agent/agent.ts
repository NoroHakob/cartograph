import { modelCallLimitMiddleware } from "langchain";
import { defineDeepAgent } from "managed-deepagents";

import { onlyMapTools } from "./middleware/only-map-tools";
import { model } from "./model";
import { askContext, MAP_TOOLS } from "./tools/map";

// The system prompt is instructions.md, next to this file.
export const agent = defineDeepAgent({
  name: "cartograph",
  model,
  tools: MAP_TOOLS,
  // The app passes each run's Ask credential here, out of the model's sight.
  contextSchema: askContext,
  middleware: [
    onlyMapTools(MAP_TOOLS.map((t) => t.name)),
    // A question needs a handful of lookups. Past this the agent is looping,
    // and every extra call spends free-tier quota.
    modelCallLimitMiddleware({ runLimit: 12, exitBehavior: "end" }),
  ],
});
