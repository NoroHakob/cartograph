"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

export function ShellNav() {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const base = `/o/${slug}`;

  const items = [
    { href: base, label: "Workspace" },
    { href: `${base}/team`, label: "Team" },
  ];

  return (
    <nav aria-label="Workspace" className="flex items-center gap-1 text-sm">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="rounded-md px-2.5 py-1.5 text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg aria-[current=page]:bg-surface-muted aria-[current=page]:text-fg"
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
