import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Clerk is the only session system: this proxy is the single place sessions
// are read and refreshed. Don't add Supabase's updateSession() middleware here.

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

// The map preview renders checked-in parser output with no account. It only
// exists in development; the page itself 404s in production.
const isPreviewRoute = createRouteMatcher(["/preview(.*)"]);

export default clerkMiddleware(
  async (auth, req) => {
    if (isPublicRoute(req)) return;
    if (process.env.NODE_ENV !== "production" && isPreviewRoute(req)) return;

    // "/" is the landing page for a signed-out visitor. Every sign-in method
    // also lands on "/", which forwards a signed-in user to the active
    // organization's workspace, or to pick one if they have none.
    const { pathname } = req.nextUrl;
    if (pathname === "/") {
      const { userId, orgSlug } = await auth();
      if (!userId) return;
      return NextResponse.redirect(new URL(orgSlug ? `/o/${orgSlug}` : "/choose-organization", req.url));
    }

    // Signed-out visitors are redirected to sign-in here, before any route
    // renders, so protected HTML is never sent.
    const { orgSlug } = await auth.protect();

    // The landing page's form. There's no page here: sign-in (above, for a
    // signed-out visitor) returns to this URL, and it carries the repository
    // on to the workspace, whose form submits it.
    if (pathname === "/start") {
      const repo = req.nextUrl.searchParams.get("repo")?.trim();
      const target = new URL(orgSlug ? `/o/${orgSlug}` : "/choose-organization", req.url);
      if (repo) target.searchParams.set("repo", repo);
      return NextResponse.redirect(target);
    }

    // organizationSyncOptions activates the org in the URL if the user belongs
    // to it. If it's still not the active org, they don't: send them to their own.
    const urlSlug = pathname.match(/^\/o\/([^/]+)/)?.[1];
    if (urlSlug && urlSlug !== orgSlug) {
      return NextResponse.redirect(new URL(orgSlug ? `/o/${orgSlug}` : "/choose-organization", req.url));
    }
  },
  {
    // Visiting /o/<slug> makes that organization active in the session token.
    organizationSyncOptions: {
      organizationPatterns: ["/o/:slug", "/o/:slug/(.*)"],
    },
  },
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
