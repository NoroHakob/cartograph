import { OrganizationList } from "@clerk/nextjs";
import { AuthFrame } from "@/components/shell/auth-frame";

// The proxy sends a signed-in user with no active organization here: someone
// who has just signed up, or has left their last organization. A repository
// submitted from the landing page rides along, so it's mapped once they pick
// or create one.
export default function ChooseOrganizationPage({ searchParams }: PageProps<"/choose-organization">) {
  return (
    <AuthFrame>
      <Organizations searchParams={searchParams} />
    </AuthFrame>
  );
}

async function Organizations({ searchParams }: Pick<PageProps<"/choose-organization">, "searchParams">) {
  const { repo } = await searchParams;
  const after = `/o/:slug${typeof repo === "string" && repo ? `?repo=${encodeURIComponent(repo)}` : ""}`;
  return <OrganizationList hidePersonal afterSelectOrganizationUrl={after} afterCreateOrganizationUrl={after} />;
}
