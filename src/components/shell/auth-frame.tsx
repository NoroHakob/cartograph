import { Suspense, type ReactNode } from "react";
import { ThemeControl } from "@/components/theme/theme-control";

/** Centered frame for screens outside the workspace: sign-in, sign-up, org picker. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between px-4">
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="grid size-6 place-items-center rounded-md bg-accent text-xs text-accent-fg">
            C
          </span>
          Cartograph
        </span>
        <ThemeControl />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-14">
        <Suspense>{children}</Suspense>
      </main>
    </div>
  );
}
