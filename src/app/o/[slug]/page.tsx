import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getIdentity } from "@/lib/identity";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Analyses, AnalysesSkeleton } from "./analyses";

export default function WorkspacePage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <Suspense fallback={<WorkspaceHeaderSkeleton />}>
        <WorkspaceHeader />
      </Suspense>

      <section aria-labelledby="analyses-heading">
        <h2 id="analyses-heading" className="sr-only">
          Analyses
        </h2>
        <Suspense fallback={<AnalysesSkeleton />}>
          <Analyses />
        </Suspense>
      </section>
    </div>
  );
}

// Rendered on the server from the session token's organization claim, so it is
// in the HTML response rather than filled in after hydration. The display name
// comes from the organization's own row, which RLS scopes to the token's
// organization exactly as it does the analyses below; the slug stands in for
// an organization that has no row yet.
async function WorkspaceHeader() {
  const identity = await getIdentity();
  if (!identity) redirect("/");

  const supabase = await createServerSupabaseClient();
  const { data: organization } = await supabase.from("organizations").select("name").maybeSingle();

  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        {organization?.name ?? identity.orgSlug}
      </h1>
      <p className="text-sm text-fg-muted">
        You&apos;re {identity.orgRole === "org:admin" ? "an admin" : "a member"} here
      </p>
    </header>
  );
}

function WorkspaceHeaderSkeleton() {
  return (
    <div aria-hidden className="flex items-baseline justify-between">
      <div className="h-8 w-56 rounded bg-surface-muted" />
      <div className="h-4 w-32 rounded bg-surface-muted" />
    </div>
  );
}
