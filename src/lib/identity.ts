import "server-only";

import { auth } from "@clerk/nextjs/server";

export type Identity = {
  userId: string;
  orgId: string;
  orgSlug: string;
  orgRole: string;
};

/**
 * The signed-in identity, read from the verified session token alone.
 *
 * This is the only place server code should learn who someone is and which
 * organization they're acting in. It never calls Clerk's API: the token
 * already carries the organization claim, and access decisions key off it.
 *
 * Returns null when there is no user or no active organization.
 */
export async function getIdentity(): Promise<Identity | null> {
  const { userId, orgId, orgSlug, orgRole } = await auth();
  if (!userId || !orgId || !orgSlug || !orgRole) return null;
  return { userId, orgId, orgSlug, orgRole };
}
