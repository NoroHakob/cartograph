"use client";

import { useOrganization } from "@clerk/nextjs";

export function Members() {
  const { memberships } = useOrganization({ memberships: { pageSize: 50 } });

  if (!memberships || memberships.isLoading) {
    return <p className="px-4 py-3 text-sm text-fg-muted">Loading members…</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {memberships.data?.map((m) => {
        const user = m.publicUserData;
        const name =
          [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.identifier;
        return (
          <li key={m.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{name}</p>
              {name !== user?.identifier && (
                <p className="truncate text-fg-muted">{user?.identifier}</p>
              )}
            </div>
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-fg-muted">
              {m.role.replace(/^org:/, "")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
