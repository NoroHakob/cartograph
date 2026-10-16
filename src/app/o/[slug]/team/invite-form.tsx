"use client";

import { useActionState } from "react";
import { inviteMember, type InviteState } from "./actions";

const initialState: InviteState = { status: "idle" };

export function InviteForm() {
  const [state, formAction, pending] = useActionState(inviteMember, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-fg-muted">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="teammate@example.com"
            className="h-9 rounded-md border border-border bg-surface px-3 text-fg outline-none placeholder:text-fg-muted/70 focus:border-accent focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:w-36">
          <span className="text-fg-muted">Role</span>
          <select
            name="role"
            defaultValue="org:member"
            className="h-9 rounded-md border border-border bg-surface px-2 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-ring"
          >
            <option value="org:member">Member</option>
            <option value="org:admin">Admin</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="h-9 self-end rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send invite"}
        </button>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm">
        {state.status === "sent" && (
          <span className="text-fg-muted">Invitation sent to {state.email}.</span>
        )}
        {state.status === "error" && <span className="text-danger">{state.message}</span>}
      </p>
    </form>
  );
}
