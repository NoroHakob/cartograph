import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getIdentity } from "@/lib/identity";

export default function WorkspacePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <Suspense fallback={<WorkspaceHeaderSkeleton />}>
        <WorkspaceHeader />
      </Suspense>

      <section className="mt-10 grid place-items-center rounded-xl border border-dashed border-border bg-surface px-6 py-20 text-center">
        <h2 className="text-base font-medium">No repositories yet</h2>
        <p className="mt-1 max-w-sm text-sm text-fg-muted">
          Maps of this team&apos;s repositories will appear here.
        </p>
      </section>
    </div>
  );
}

// Rendered on the server from the session token's organization claim, so it is
// in the HTML response rather than filled in after hydration.
async function WorkspaceHeader() {
  const identity = await getIdentity();
  if (!identity) redirect("/");

  return (
    <header>
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Workspace</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{identity.orgSlug}</h1>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-fg-muted">
        <div className="flex gap-1.5">
          <dt>Organization</dt>
          <dd className="font-mono text-fg">{identity.orgId}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Your role</dt>
          <dd className="text-fg">{identity.orgRole.replace(/^org:/, "")}</dd>
        </div>
      </dl>
    </header>
  );
}

function WorkspaceHeaderSkeleton() {
  return (
    <div aria-hidden>
      <div className="h-3 w-20 rounded bg-surface-muted" />
      <div className="mt-2 h-7 w-48 rounded bg-surface-muted" />
      <div className="mt-3 h-4 w-80 rounded bg-surface-muted" />
    </div>
  );
}
