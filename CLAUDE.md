# Cartograph

A local app that reads a public GitHub repo and draws it as a dependency map. Everything shown on screen comes from actually parsing the code. The AI only explains what the parser found; it never decides what exists.

The reasons behind these rules live in `docs/project-doc.md`. This file is just the rules.

## Stack

Next.js 16 App Router, React 19, TypeScript (strict). ts-morph for parsing. React Flow and dagre for the map. Clerk for sign-in and organizations. Supabase for Postgres, row-level security and realtime. Google Gemini through `@langchain/google`, in one wrapped client (`src/ai/client.ts`), traced with LangSmith. Tailwind v4. pnpm.

## Rules

- The parser is the source of truth. Never let the AI add, remove or rename files, folders or imports on the map.
- All model calls go through the single wrapped client in `src/ai/client.ts`. Never import the model SDK or langsmith anywhere else (ESLint enforces it). The one exception is the agent service in `agent/`: it runs separately and can't import app code, so its model is constructed once in `agent/model.ts`, matching the app's pinned model and settings.
- Every AI answer must reference only nodes and edges the parser produced.
- Supabase tables use row-level security. Never bypass it with the service role key in client code.
- Keep secrets in `.env.local`. Never commit them.
- TypeScript strict mode stays on. No `any` without a comment explaining why.
- Use pnpm for everything. Don't add npm or yarn lockfiles.

## Commands

- `pnpm dev`: start the dev server at http://localhost:3000
- `pnpm build`: production build
- `pnpm lint`: run ESLint

## Before building something

Read the relevant section of `docs/project-doc.md` first. Don't read the whole doc at once.
