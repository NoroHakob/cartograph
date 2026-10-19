import { defineIdentity } from "managed-deepagents";

// Who may call this agent: only the Cartograph app. The app signs members in
// with Clerk, then calls the agent as a trusted backend, presenting
// MDA_INGRESS_SECRET and the member's user id (x-mda-user-id). Each member's
// threads are private to them. The browser never talks to the agent directly.
export const identity = defineIdentity({
  auth: "backend",
});
