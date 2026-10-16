import { readEnv } from "./required";

// Each NEXT_PUBLIC_ value is referenced literally so Next can inline it into
// the client bundle. Safe to import from client and server code.
export const publicEnv = {
  supabaseUrl: readEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  supabasePublishableKey: readEnv(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
  signInUrl: readEnv(
    "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
    process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
  ),
} as const;
