# Cartograph

The product decisions behind this build, written down before it starts, with the reasoning included. The reasoning matters more than the decisions themselves: you'll hit situations this doc doesn't cover, and you'll need to know which way the thinking leaned.

Read the section you need before you build something. Don't read it all at once, and don't paste the whole thing into a prompt.

## What it is

Sign in with GitHub, paste a public TypeScript or JavaScript repository URL, and get a map of it. Folders appear as boxes and imports as lines between them. Open a folder to see its files. Select a file to see what it imports, what imports it, and what would break two levels out if it changed. Ask questions about the codebase and get answers grounded in the map.

## Why the parser decides, not the AI

A map that's wrong is worse than no map. If the AI invents a dependency, the user will trust it and act on it. So ts-morph builds the graph, and the AI only describes and explains that graph. If the parser can't resolve something, the map shows it as unresolved rather than guessing.

## Scope

- Public repos only, so there are no private-code or token-scope problems at the start.
- TypeScript and JavaScript only, since ts-morph handles both well.
- Large repos: parse once, store the result, and reuse it. Don't re-parse on every visit.

## Data

- Supabase Postgres stores repos, parsed graphs and chat history.
- Row-level security keys every row to a Clerk user or organization.
- Realtime pushes parsing progress to the UI so long parses don't look frozen.

## AI

- One wrapped OpenAI client, so models, retries and limits are changed in one place.
- Every call is traced in LangSmith, so bad answers can be traced back to their inputs.
- Answers pass the AI the relevant part of the graph, not the whole repo.

## The map

- React Flow renders the map, and dagre handles the layout.
- Start collapsed at folder level. Expanding is the user's choice, because a full file-level graph of a real repo is unreadable.

## Open questions

- How to show circular imports clearly.
- How to handle monorepos with several packages.
- When a stored graph is stale and should be re-parsed.
