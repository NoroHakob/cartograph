import { OrganizationList } from "@clerk/nextjs";
import { AuthFrame } from "@/components/shell/auth-frame";

// The proxy forwards "/" to the active organization's workspace, so this only
// renders for a signed-in user with no active organization (for example after
// leaving their last one).
export default function Home() {
  return (
    <AuthFrame>
      <OrganizationList
        hidePersonal
        afterSelectOrganizationUrl="/o/:slug"
        afterCreateOrganizationUrl="/o/:slug"
      />
    </AuthFrame>
  );
}
