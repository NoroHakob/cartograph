import "server-only";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/env/public";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Every request carries the signed-in user's Clerk session token, so RLS
 * policies can read its claims (`auth.jwt()->>'sub'`, `auth.jwt()->'o'->>'id'`).
 * Supabase never owns a session here: Clerk is the only session system.
 *
 * Create one per request; don't cache it at module scope.
 */
export function createServerSupabaseClient() {
  return createClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    async accessToken() {
      return (await auth()).getToken();
    },
  });
}
