/**
 * Master auth, plus an optional restricted "reviewer" role.
 *
 * The platform has exactly one full user — the agency operator who's
 * configured `MASTER_EMAIL` + `MASTER_PASSWORD` in `.env`. Login validates
 * incoming credentials against those env values and, on match, sets an
 * HTTP-only signed cookie.
 *
 * A second, optional credential pair (`REVIEWER_EMAIL` / `REVIEWER_PASSWORD`)
 * logs in as a restricted "reviewer" role — used to hand Meta App Review a
 * login that can only reach the automation/inbox surface, never campaigns,
 * connections, or anything destructive. When either reviewer env var is
 * unset, the reviewer login is disabled outright (never falls back to an
 * empty-password match).
 *
 * Session model: the cookie value is HMAC-SHA256(SESSION_SECRET, <role tag>).
 * Each role gets its own deterministic tag ("auth-v1" for owner,
 * "auth-v1-reviewer" for reviewer) so the two values never collide and,
 * critically, the owner's value is unchanged from before this role was
 * added — existing owner sessions keep working. Pros of the scheme overall:
 *   • No JWT/expiry/payload complexity for a two-role tool.
 *   • Rotating SESSION_SECRET invalidates all sessions instantly.
 *   • Cookie's own Max-Age handles browser-side expiry.
 *
 * Web Crypto SubtleCrypto is used (not Node's `crypto`) so this same file
 * can be imported from edge middleware without runtime errors.
 */

export const SESSION_COOKIE = "mt_session";
// 30 days. Re-login required after this; cookie also clears on logout.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type SessionRole = "owner" | "reviewer";

function getEnv(): {
  email: string;
  password: string;
  secret: string;
} {
  const email = process.env.MASTER_EMAIL;
  const password = process.env.MASTER_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!email || !password || !secret) {
    throw new Error(
      "Missing auth env vars — set MASTER_EMAIL, MASTER_PASSWORD, SESSION_SECRET in .env",
    );
  }
  return { email, password, secret };
}

/**
 * Reviewer credentials. Returns null (not a thrown error) when either env
 * var is unset — the reviewer login is simply disabled in that case, rather
 * than ever treating a missing password as a blank-password match.
 */
function getReviewerEnv(): { email: string; password: string } | null {
  const email = process.env.REVIEWER_EMAIL;
  const password = process.env.REVIEWER_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

function base64UrlEncode(bytes: ArrayBuffer): string {
  // Edge runtime has Buffer-less base64. Use btoa via Uint8Array.
  const arr = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return base64UrlEncode(sig);
}

/**
 * Returns the canonical signed value the session cookie must hold to be
 * considered authenticated as the owner. Compare incoming cookie values to
 * this via a constant-time check.
 *
 * Unchanged from before the reviewer role existed — same secret, same tag
 * ("auth-v1") — so pre-existing owner sessions remain valid.
 */
export async function getExpectedSessionValue(): Promise<string> {
  const { secret } = getEnv();
  return hmacSha256(secret, "auth-v1");
}

/**
 * Canonical signed value for a reviewer session — a distinct tag over the
 * same SESSION_SECRET, so it can never collide with the owner's value.
 */
export async function getExpectedReviewerSessionValue(): Promise<string> {
  const { secret } = getEnv();
  return hmacSha256(secret, "auth-v1-reviewer");
}

/**
 * Constant-time string compare to avoid leaking timing information when
 * verifying session cookies. Falls back to equal-length normalisation.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Resolves a session cookie to a role, or null if it matches neither the
 * owner's nor the reviewer's expected value. This is the source of truth —
 * `isSessionValid` is defined in terms of it.
 */
export async function getSessionRole(
  cookieValue: string | undefined,
): Promise<SessionRole | null> {
  if (!cookieValue) return null;
  try {
    const expectedOwner = await getExpectedSessionValue();
    if (safeEqual(cookieValue, expectedOwner)) return "owner";
  } catch {
    // Owner env misconfigured — fall through and still try reviewer.
  }
  try {
    const expectedReviewer = await getExpectedReviewerSessionValue();
    if (safeEqual(cookieValue, expectedReviewer)) return "reviewer";
  } catch {
    // Reviewer env misconfigured — no match.
  }
  return null;
}

export async function isSessionValid(
  cookieValue: string | undefined,
): Promise<boolean> {
  return (await getSessionRole(cookieValue)) !== null;
}

/**
 * Verify a login attempt against the master credentials in env.
 * Returns true iff the email AND password both match (case-sensitive).
 */
export function verifyCredentials(email: string, password: string): boolean {
  let envEmail: string;
  let envPassword: string;
  try {
    ({ email: envEmail, password: envPassword } = getEnv());
  } catch {
    return false;
  }
  // Constant-time compare on both fields. Trim email so trailing whitespace
  // in the form input doesn't bite users.
  const emailOk = safeEqual(email.trim().toLowerCase(), envEmail.toLowerCase());
  const passwordOk = safeEqual(password, envPassword);
  return emailOk && passwordOk;
}

/**
 * Verify a login attempt against the reviewer credentials in env. Returns
 * false (never a blank-password match) when the reviewer role is disabled,
 * i.e. either REVIEWER_EMAIL or REVIEWER_PASSWORD is unset.
 */
export function verifyReviewerCredentials(
  email: string,
  password: string,
): boolean {
  const reviewerEnv = getReviewerEnv();
  if (!reviewerEnv) return false;
  const emailOk = safeEqual(
    email.trim().toLowerCase(),
    reviewerEnv.email.toLowerCase(),
  );
  const passwordOk = safeEqual(password, reviewerEnv.password);
  return emailOk && passwordOk;
}

/**
 * The only surface a reviewer session may reach: the automation/inbox pages
 * and their API, plus the auth API (so a reviewer can still log out). Used
 * both by middleware (to gate navigation) and by the dashboard layout (to
 * decide which sidebar entries a reviewer should even see) — one predicate,
 * so the two can't drift apart.
 */
export function isReviewerAllowedPath(pathname: string): boolean {
  return (
    pathname === "/dashboard/automation" ||
    pathname.startsWith("/dashboard/automation/") ||
    pathname === "/api/automation" ||
    pathname.startsWith("/api/automation/") ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/")
  );
}
