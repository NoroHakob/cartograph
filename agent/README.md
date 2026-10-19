# Cartograph agent

The Ask agent: a Managed Deep Agent that answers questions about one analysis
by looking them up. It runs as its own service, separate from the app.

```text
agent.ts                     the agent: model, six map tools, run context, two middleware
instructions.md              system prompt: look before answering, never infer, refuse what the map can't answer
model.ts                     gemini-3.8-flash via ChatGoogle, no grounding (or the scripted stand-in)
scripted-model.ts            CARTOGRAPH_MODEL=scripted: fixed real lookups, no model, for testing the plumbing
tools/map.ts                 the six tools; each POSTs to the app's tool surface with the run's Ask credential
middleware/only-map-tools.ts hides Deep Agents' built-in planner, filesystem and sub-agent tools
identity.ts                  trusted backend: only the app calls this, with MDA_INGRESS_SECRET
scripts/ask.mjs              terminal client that prints each lookup as it happens
```

## How a question flows

1. The member asks in the app. `POST /api/ask` has the database mint an Ask
   credential for that analysis, which it does only for the member's own
   organization. The signing key lives in Supabase Vault and never leaves it.
2. The app opens or continues a thread here as a trusted backend
   (`x-mda-ingress-secret`, `x-mda-user-id`), and starts a run with the
   credential in the run's `context`. The model never sees it.
3. Each tool sends the credential as a bearer token to `/api/ask/tools/<name>`.
   That route reads Supabase as anon with the credential, and RLS shows it
   exactly one analysis. It answers with the same graph functions that draw
   the canvas.
4. The app relays the run back to the browser as it happens, translated into
   one small event per line (a lookup started, a lookup's result, answer text;
   see `src/ask/events.ts`), and the Ask panel shows each lookup as it arrives.

## Evaluation

`pnpm eval:ask` in the app (see `evals/ask.ts`) asks this agent the
conversations in `evals/datasets/ask.json` about the hono fixture, and scores
whether it looked things up rather than hedging, and whether it kept its
plumbing out of its answers. Run the agent with Gemini (not scripted) and
`CARTOGRAPH_TOOLS_URL=http://127.0.0.1:3999/tools`, with `pnpm ask:tools`
serving the fixture. It spends Gemini quota: around 25 agent runs plus three
judge calls.

No tool takes an analysis id, and nothing in the path holds a key that can
read every analysis.

## Run it locally

1. App: `MDA_INGRESS_SECRET` and `AGENT_URL=http://localhost:2024` in
   `.env.local`, then `pnpm dev`.
2. Here: `pnpm install`, copy `.env.example` to `.env`, and fill it in with the
   same `MDA_INGRESS_SECRET`.
3. `pnpm dev` (`mda dev .`). On Windows, if it stops with ``could not find `npx` ``,
   it has already compiled to `.mda/dev`, so start that build directly:
   `cd .mda/dev; npx --yes @langchain/langgraph-cli@^1.5.1 dev --port 2024 --no-browser`,
   with the variables from `.env` set in the shell. Don't set `MDA_LOCAL_DEV`
   unless you want Studio: it lets requests in without the ingress secret.

To try the agent with no app and no credential, run `pnpm ask:tools` in the
app (the checked-in fixture, no auth) and set
`CARTOGRAPH_TOOLS_URL=http://127.0.0.1:3999/tools`.
