import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Clerk is the only session system: this proxy is the single place sessions
// are read and refreshed. Don't add Supabase's updateSession() middleware here.

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(
  async (auth, req) => {
    if (isPublicRoute(req)) return;

    // Signed-out visitors are redirected to sign-in here, before any route
    // renders, so protected HTML is never sent.
    const { orgSlug } = await auth.protect();

    // Every sign-in method lands on "/", which forwards to the active
    // organization's workspace.
    const { pathname } = req.nextUrl;
    if (pathname === "/" && orgSlug) {
      return NextResponse.redirect(new URL(`/o/${orgSlug}`, req.url));
    }

    // organizationSyncOptions activates the org in the URL if the user belongs
    // to it. If it's still not the active org, they don't: send them to their own.
    const urlSlug = pathname.match(/^\/o\/([^/]+)/)?.[1];
    if (urlSlug && urlSlug !== orgSlug) {
      return NextResponse.redirect(new URL(orgSlug ? `/o/${orgSlug}` : "/", req.url));
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
