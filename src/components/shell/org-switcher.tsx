"use client";

import { OrganizationSwitcher, useOrganization } from "@clerk/nextjs";

/**
 * "Manage organization" goes to our Team page instead of Clerk's modal: the
 * modal's invite button sends links to Clerk's hosted portal, while invites
 * created on the Team page land on this app's own sign-in page.
 */
export function OrgSwitcher() {
  const { organization } = useOrganization();

  return (
    <OrganizationSwitcher
      hidePersonal
      afterSelectOrganizationUrl="/o/:slug"
      afterCreateOrganizationUrl="/o/:slug"
      afterLeaveOrganizationUrl="/"
      organizationProfileMode="navigation"
      organizationProfileUrl={
        organization?.slug ? `/o/${organization.slug}/team` : "/"
      }
    />
  );
}
