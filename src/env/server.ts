import "server-only";

import { readEnv } from "./required";

// Secrets. Importing this from client code fails the build, which is the point.
// Read on use rather than on import, so scripts that never touch a secret
// don't need it set.
export const serverEnv = {
  get supabaseSecretKey() {
    return readEnv("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY);
  },
};
