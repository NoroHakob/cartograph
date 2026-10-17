// Every variable the app needs to boot. next.config.ts calls assertEnv() so a
// missing or blank value stops `pnpm dev` / `pnpm build` immediately instead of
// surfacing as a confusing auth or network error later.
//
// This file must stay free of `server-only` and Next imports: it runs in plain
// Node while the config loads.

export const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
] as const;

export type RequiredEnvName = (typeof REQUIRED_ENV)[number];

export function assertEnv(source: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED_ENV.filter((name) => !source[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing
        .map((name) => `  - ${name}`)
        .join("\n")}\nSet them in .env.local and restart.`,
    );
  }
}

export function readEnv(name: RequiredEnvName, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}
