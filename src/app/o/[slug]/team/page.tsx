import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import { InviteForm } from "./invite-form";
import { Members } from "./members";

export default function TeamPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-sm text-fg-muted">
          People in this organization can see its repositories and maps.
        </p>
      </header>

      <Suspense>
        <InviteSection />
      </Suspense>

      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <h2 className="border-b border-border px-4 py-3 text-sm font-medium">Members</h2>
        <Members />
      </section>
    </div>
  );
}

async function InviteSection() {
  const { has } = await auth();
  if (!has({ role: "org:admin" })) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-medium">Invite someone</h2>
      <InviteForm />
    </section>
  );
}
