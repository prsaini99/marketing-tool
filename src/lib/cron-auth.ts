/**
 * Bearer-token guard for the /api/cron/* routes.
 *
 * These routes are the ONLY authenticated-by-themselves endpoints in the app:
 * src/middleware.ts exempts the whole /api/cron/ prefix, because a scheduler
 * carries no browser session cookie. That exemption means this function is
 * the entire security boundary for endpoints that sync from Meta, send email,
 * spend OpenAI credits, and execute automated budget rules against a live ad
 * account.
 *
 * FAILS CLOSED. An earlier version treated CRON_SECRET as optional and
 * skipped the check when it was unset, which is backwards: the deployment
 * most likely to be missing the variable is a fresh one, and that is exactly
 * when the endpoints must not be world-callable. A missing secret now denies
 * every request and logs loudly, so the failure shows up as "my cron returns
 * 401" rather than as a stranger pausing campaigns.
 *
 * The response is a generic 401 either way. The server log distinguishes
 * misconfiguration from a bad token; the caller does not need to know which.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically once
 * the variable exists in the project, so no per-job configuration is needed.
 *
 * Usage in a route handler:
 *
 *   export async function GET(req: Request) {
 *     const denied = requireCronAuth(req);
 *     if (denied) return denied;
 *     ...
 *   }
 */

import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/auth";

/**
 * Returns a 401 response to return immediately, or null when the caller is
 * authorised. Null-means-proceed keeps the call site a two-liner and makes
 * forgetting the guard visible: there is no boolean to accidentally ignore.
 */
export function requireCronAuth(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error(
      "[cron] CRON_SECRET is not set. Every /api/cron/* request will be " +
        "rejected until it is. Set it in the deployment environment; Vercel " +
        "Cron then sends it automatically.",
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // safeEqual is constant-time over equal-length strings and returns false
  // immediately on a length mismatch. The length of a bearer header is not
  // secret, so that early exit is fine here.
  const provided = req.headers.get("authorization") ?? "";
  if (!safeEqual(provided, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
