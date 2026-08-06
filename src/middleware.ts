/**
 * Auth middleware.
 *
 * Any request to /dashboard/* (and the /api routes that mutate state) must
 * carry a valid signed session cookie. Otherwise, redirect to /login with
 * the intended URL in ?next= so the user lands back where they meant to go
 * after signing in.
 *
 * Public routes (login, forgot-password, the auth API itself) are excluded
 * via `config.matcher` below.
 *
 * A "reviewer" session (see src/lib/auth.ts — Meta App Review's restricted
 * login) is further confined to the automation/inbox surface only:
 * /dashboard/automation/* and /api/automation/* (plus /api/auth/* so it can
 * still log out). Anything else is blocked here, even though the cookie is
 * otherwise valid — HTML requests bounce to /dashboard/automation instead
 * of /login (a reviewer session logging back into the same restricted view
 * isn't a login failure), API requests get a 403 explaining the
 * restriction. Owner sessions never hit this branch.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSessionRole, isReviewerAllowedPath, SESSION_COOKIE } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const role = await getSessionRole(cookie);

  if (!role) {
    // For HTML page requests, redirect to /login with the return path
    // attached. For API requests, 401 (the client decides whether to
    // redirect).
    const url = req.nextUrl.clone();
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 },
      );
    }
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(
      req.nextUrl.pathname + req.nextUrl.search,
    )}`;
    return NextResponse.redirect(url);
  }

  if (role === "reviewer" && !isReviewerAllowedPath(req.nextUrl.pathname)) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Reviewer accounts can only access automation" },
        { status: 403 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard/automation";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Run on dashboard pages + every API route except the auth ones (login/logout
// must be reachable without a session) and the public cron tick + Meta
// webhook (neither carries a browser cookie; the webhook is authenticated by
// HMAC signature).
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/((?!auth/|cron/|webhooks/).+)",
  ],
};
