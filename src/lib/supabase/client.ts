"use client";

import { useSession } from "@clerk/nextjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import { publicEnv } from "@/env/public";

/**
 * Supabase client for Client Components.
 *
 * The token is fetched per request from the current Clerk session, so it is
 * always fresh and always reflects the active organization. Supabase never
 * persists or refreshes a session of its own.
 */
export function useSupabase(): SupabaseClient {
  const { session } = useSession();

  return useMemo(
    () =>
      createClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
        async accessToken() {
          return (await session?.getToken()) ?? null;
        },
      }),
    [session],
  );
}
