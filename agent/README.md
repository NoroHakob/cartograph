# Cartograph agent

The Ask agent: a Managed Deep Agent that answers questions about one analysis
by looking them up. It runs as its own service, separate from the app.

```text
agent.ts                     the agent: Gemini, six map tools, two middleware
instructions.md              system prompt: look before answering, never infer, refuse what the map can't answer
model.ts                     gemini-3.8-flash via ChatGoogle, no grounding
tools/map.ts                 the six tools; each POSTs to the app's tool surface
middleware/only-map-tools.ts hides Deep Agents' built-in planner, filesystem and sub-agent tools
identity.ts                  scaffold default (LangSmith API key); replaced when the app mints credentials
scripts/ask.mjs              terminal client that prints each lookup as it happens
```

The tools compute nothing. The app answers them with the same graph functions
that draw the canvas (`src/ask/tools.ts`). No tool takes an analysis id.

## Run it locally

1. App side, in the repo root: `pnpm ask:tools` serves the tools over the
   checked-in hono fixture on `http://127.0.0.1:3999`. You can pass another
   `pnpm parse --out` result as an argument.
2. Here: `pnpm install`, copy `.env.example` to `.env` and fill it in.
3. `pnpm dev` (`mda dev .`). On Windows, if it stops with ``could not find `npx` ``,
   it has already compiled to `.mda/dev`, so start that build directly:
   `cd .mda/dev; npx --yes @langchain/langgraph-cli@^1.5.1 dev --port 2024 --no-browser`
   with `GOOGLE_API_KEY` set in the shell and `MDA_LOCAL_DEV=1`.
4. `node scripts/ask.mjs "where is authentication handled?" "what breaks if I change that?"`
   with `LANGSMITH_API_KEY` set, or open the Studio URL the server prints.
