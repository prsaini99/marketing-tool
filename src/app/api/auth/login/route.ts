/**
 * POST /api/auth/login
 *
 * Body: { email: string, password: string }
 *
 * Validates against, in order:
 *   1. the `AppUser` table — logins the owner can create/revoke (and expire)
 *      without editing env vars and redeploying;
 *   2. MASTER_EMAIL + MASTER_PASSWORD (owner) / REVIEWER_EMAIL +
 *      REVIEWER_PASSWORD (restricted reviewer) in env.
 *
 * The env fallback stays deliberately: it's what stops a lockout when the
 * table is empty, the DB is unreachable, or a hash is corrupt. A DB lookup
 * that throws logs a warning and falls through to env rather than failing
 * the login.
 *
 * On success sets the matching role's signed session cookie; on failure
 * returns 401 with the same generic message regardless of which credential
 * source almost matched — never reveal which set (or which field) was wrong.
 *
 * This route runs on Node (not edge), which is what lets it touch Prisma via
 * `verifyUserCredentials`. Middleware's `src/lib/auth.ts` must stay
 * Prisma-free; see the header of src/server/services/auth/users.ts.
 */

import { NextResponse } from "next/server";
import {
  getExpectedReviewerSessionValue,
  getExpectedSessionValue,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  verifyCredentials,
  verifyReviewerCredentials,
  type SessionRole,
} from "@/lib/auth";
import { verifyUserCredentials } from "@/server/services/auth/users";

interface Body {
  email?: unknown;
  password?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  // DB first, then env. Every check runs through its own constant-time
  // compare; the generic failure message below doesn't distinguish which
  // source (if any) was closer to matching.
  let role: SessionRole | null = null;

  try {
    role = await verifyUserCredentials(body.email, body.password);
  } catch (err) {
    // DB down / migration missing / client stale. Don't fail the login —
    // fall through to the env credentials, which exist for exactly this.
    console.warn(
      "[auth] AppUser lookup failed, falling back to env credentials:",
      err instanceof Error ? err.message : err,
    );
  }

  if (!role) {
    if (verifyCredentials(body.email, body.password)) {
      role = "owner";
    } else if (verifyReviewerCredentials(body.email, body.password)) {
      role = "reviewer";
    }
  }

  if (!role) {
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 },
    );
  }

  const sessionValue =
    role === "owner"
      ? await getExpectedSessionValue()
      : await getExpectedReviewerSessionValue();

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: sessionValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
