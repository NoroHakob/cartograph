"use client";

import { useActionState } from "react";
import { startAnalysis, type StartState } from "./actions";

const initialState: StartState = { status: "idle" };

export function AnalyzeForm() {
  const [state, formAction, pending] = useActionState(startAnalysis, initialState);
  const failed = state.status === "error";

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-2">
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
          defaultValue={failed ? state.url : undefined}
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
