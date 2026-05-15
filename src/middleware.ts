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
 */

import { NextResponse, type NextRequest } from "next/server";
import { isSessionValid, SESSION_COOKIE } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = await isSessionValid(cookie);

  if (ok) return NextResponse.next();

  // For HTML page requests, redirect to /login with the return path attached.
  // For API requests, 401 (the client decides whether to redirect).
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

// Run on dashboard pages + every API route except the auth ones (login/logout
// must be reachable without a session) and the public cron tick (called by
// the worker which doesn't carry a browser cookie).
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/((?!auth/|cron/).+)",
  ],
};
