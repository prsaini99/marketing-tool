/**
 * Single-user master auth.
 *
 * The platform has exactly one user today — the agency operator who's
 * configured `MASTER_EMAIL` + `MASTER_PASSWORD` in `.env`. Login validates
 * incoming credentials against those env values and, on match, sets an
 * HTTP-only signed cookie.
 *
 * Session model: the cookie value is HMAC-SHA256(SESSION_SECRET, "auth-v1").
 * It's a deterministic, single-bit "logged in or not" token. Pros:
 *   • No JWT/expiry/payload complexity for a one-user tool.
 *   • Rotating SESSION_SECRET invalidates all sessions instantly.
 *   • Cookie's own Max-Age handles browser-side expiry.
 *
 * Web Crypto SubtleCrypto is used (not Node's `crypto`) so this same file
 * can be imported from edge middleware without runtime errors.
 */

export const SESSION_COOKIE = "mt_session";
// 30 days. Re-login required after this; cookie also clears on logout.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

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
 * considered authenticated. Compare incoming cookie values to this via a
 * constant-time check.
 */
export async function getExpectedSessionValue(): Promise<string> {
  const { secret } = getEnv();
  return hmacSha256(secret, "auth-v1");
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

export async function isSessionValid(
  cookieValue: string | undefined,
): Promise<boolean> {
  if (!cookieValue) return false;
  try {
    const expected = await getExpectedSessionValue();
    return safeEqual(cookieValue, expected);
  } catch {
    return false;
  }
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
