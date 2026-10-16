import "server-only";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/env/public";
import type { Database } from "./database.types";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Every request carries the signed-in user's Clerk session token, so RLS
 * policies can read its claims (`auth.jwt()->>'sub'`, `auth.jwt()->'o'->>'id'`).
 * Supabase never owns a session here: Clerk is the only session system.
 *
 * Create one per request; don't cache it at module scope.
 *
 * The token is read here, in the request's own async context, rather than
 * lazily inside accessToken(): supabase-js calls accessToken() once at
 * construction from a detached promise (to prime Realtime), and a request API
 * like auth() called from there rejects during prerendering.
 */
export async function createServerSupabaseClient() {
  const token = await (await auth()).getToken();
  return createClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    async accessToken() {
      return token;
    },
  });
}
