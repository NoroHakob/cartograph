import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/env/public";
import type { Database } from "./database.types";

/**
 * Supabase client for the Ask tool surface, which has no signed-in user.
 *
 * It reads as anon with the publishable key, and sends the Ask credential in
 * the x-ask-credential header. RLS verifies the credential in the database
 * and shows exactly the one analysis it names; a missing, forged or expired
 * credential sees nothing. No key here can read anything on its own.
 *
 * Create one per request; don't cache it at module scope.
 */
export function createAskSupabaseClient(credential: string) {
  return createClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-ask-credential": credential } },
  });
}
