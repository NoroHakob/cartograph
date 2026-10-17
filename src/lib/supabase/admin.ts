import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/env/public";
import { serverEnv } from "@/env/server";
import type { Database } from "./database.types";

/**
 * Supabase client that bypasses row-level security. Server only.
 *
 * For the analysis pipeline and nothing else: a run outlives the request that
 * started it, so it can't write as the signed-in user. Whatever calls this has
 * already decided which analysis it is writing to; nothing here checks who is
 * asking. Anything acting on behalf of a person uses createServerSupabaseClient.
 */
export function createAdminSupabaseClient() {
  return createClient<Database>(publicEnv.supabaseUrl, serverEnv.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
