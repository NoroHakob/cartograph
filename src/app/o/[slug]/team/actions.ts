"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { headers } from "next/headers";
import { publicEnv } from "@/env/public";

export type InviteState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

const ROLES = ["org:member", "org:admin"] as const;

export async function inviteMember(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  // Re-authorize from the token on every call; never trust the form.
  const { userId, orgId, has } = await auth();
  if (!userId || !orgId) return { status: "error", message: "You're not signed in to an organization." };
  if (!has({ role: "org:admin" })) {
    return { status: "error", message: "Only admins can invite people." };
  }

  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "org:member");
  if (!email) return { status: "error", message: "Enter an email address." };
  if (!(ROLES as readonly string[]).includes(role)) {
    return { status: "error", message: "Unknown role." };
  }

  // The invitation link lands on this app's own sign-in page, which accepts
  // the invitation ticket and signs the person into this organization.
  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ??
    `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host")}`;
  const redirectUrl = new URL(publicEnv.signInUrl, origin).toString();

  try {
    const clerk = await clerkClient();
    await clerk.organizations.createOrganizationInvitation({
      organizationId: orgId,
      inviterUserId: userId,
      emailAddress: email,
      role,
      redirectUrl,
    });
    return { status: "sent", email };
  } catch (error) {
    const message = isClerkAPIResponseError(error)
      ? (error.errors[0]?.longMessage ?? error.errors[0]?.message ?? "Couldn't send the invitation.")
      : "Couldn't send the invitation.";
    return { status: "error", message };
  }
}
