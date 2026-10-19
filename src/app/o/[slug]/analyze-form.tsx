"use client";

import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { startAnalysis, type StartState } from "./actions";

const initialState: StartState = { status: "idle" };

/**
 * The form with whatever the landing page sent: a repository in ?repo= is
 * filled in and submitted as soon as the form mounts, so a visitor who
 * pasted a URL before signing in goes straight on to its analysis.
 */
export function LinkedAnalyzeForm() {
  const repo = useSearchParams().get("repo") ?? undefined;
  return <AnalyzeForm repo={repo} />;
}

export function AnalyzeForm({ repo }: { repo?: string }) {
  const [state, formAction, pending] = useActionState(startAnalysis, initialState);
  const failed = state.status === "error";
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (!repo || submitted.current) return;
    submitted.current = true;
    // Drop ?repo= from the address bar, so reloading after an error doesn't
    // submit again.
    window.history.replaceState(null, "", window.location.pathname);
    formRef.current?.requestSubmit();
  }, [repo]);

  return (
    <form ref={formRef} action={formAction} className="mt-8 flex flex-col gap-2">
      <label htmlFor="repository-url" className="text-sm font-medium">
        Map a repository
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="repository-url"
          name="url"
          type="text"
          inputMode="url"
          required
          autoComplete="off"
          spellCheck={false}
          // Keeps what was typed when the action returns an error.
          defaultValue={failed ? state.url : repo}
          key={failed ? state.url : "idle"}
          placeholder="https://github.com/owner/repository"
          aria-invalid={failed || undefined}
          aria-describedby="repository-url-hint"
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 font-mono text-[13px] text-fg outline-none placeholder:font-sans placeholder:text-sm placeholder:text-fg-muted/70 focus:border-accent focus:ring-2 focus:ring-ring aria-invalid:border-danger"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Checking…" : "Map it"}
        </button>
      </div>
      <p id="repository-url-hint" role="status" aria-live="polite" className="min-h-5 text-sm">
        {failed ? (
          <span className="text-danger">{state.message}</span>
        ) : (
          <span className="text-fg-muted">
            Public GitHub repositories only. A repository that&apos;s already mapped opens its existing analysis.
          </span>
        )}
      </p>
    </form>
  );
}
