/**
 * POST /api/auth/login
 *
 * Body: { email: string, password: string }
 *
 * Validates against, in order:
 *   1. the `AppUser` table — logins the owner can create/revoke (and expire)
 *      without editing env vars and redeploying. Both roles live here;
 *   2. MASTER_EMAIL + MASTER_PASSWORD in env, owner only.
 *
 * The env fallback stays deliberately: it's what stops a lockout when the
 * table is empty, the DB is unreachable, or a hash is corrupt. A DB lookup
 * that throws logs a warning and falls through to env rather than failing
 * the login.
 *
 * That fallback is owner-only on purpose. A lockout guard has to be the
 * account that can fix the lockout, and a reviewer session can reach only the
 * automation surface, so a reviewer fallback would rescue nobody. Reviewer
 * accounts are handed to outside parties and must be revocable and expirable
 * from the database, which a value baked into the deployment's env is not.
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
  type SessionRole,
} from "@/lib/auth";
import { verifyUserCredentials } from "@/server/services/auth/users";
import { clientIpFrom, createRateLimiter } from "@/lib/rate-limit";

interface Body {
  email?: unknown;
  password?: unknown;
}

/**
 * Brute-force guard. This route is exempt from the session middleware by
 * necessity, so it is the one publicly reachable endpoint that guards a
 * credential, and until now it accepted unlimited guesses.
 *
 * 10 attempts per IP per 15 minutes: high enough that nobody fat-fingering a
 * password notices, low enough that guessing is hopeless. A successful login
 * clears the counter, so a user who mistypes twice and then gets it right
 * starts fresh.
 *
 * Module scope means the counter is per serverless instance. See the note in
 * src/lib/rate-limit.ts about what that does and does not buy.
 */
const loginLimiter = createRateLimiter({
  limit: 10,
  windowMs: 15 * 60 * 1000,
});

export async function POST(req: Request) {
  const ip = clientIpFrom(req.headers);
  const gate = loginLimiter.check(ip, Date.now());
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      {
        status: 429,
        headers: { "retry-after": String(gate.retryAfterSeconds) },
      },
    );
  }

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

  if (!role && verifyCredentials(body.email, body.password)) {
    role = "owner";
  }

  if (!role) {
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 },
    );
  }

  // Correct credentials, so this IP is not an attacker. Clear its counter so
  // earlier typos do not eat into a later window.
  loginLimiter.reset(ip);

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
