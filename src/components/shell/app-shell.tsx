import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ThemeControl } from "@/components/theme/theme-control";
import { OrgSwitcher } from "./org-switcher";
import { ShellNav } from "./shell-nav";

/**
 * The frame every signed-in page renders inside. The chrome is static and
 * prerenders into the shell; anything that depends on the session streams
 * in behind its own Suspense boundary.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b border-border bg-surface/90 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span aria-hidden className="grid size-6 place-items-center rounded-md bg-accent text-xs text-accent-fg">
              C
            </span>
            <span className="hidden sm:inline">Cartograph</span>
          </Link>
          <span aria-hidden className="h-5 w-px bg-border" />
          <Suspense fallback={<div className="h-8 w-36 animate-pulse rounded-md bg-surface-muted" />}>
            <OrgSwitcher />
          </Suspense>
          <Suspense>
            <ShellNav />
          </Suspense>
        </div>
        <div className="flex items-center gap-3">
          <ThemeControl />
          <Suspense fallback={<div className="size-7 animate-pulse rounded-full bg-surface-muted" />}>
            <UserButton />
          </Suspense>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
