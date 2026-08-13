/**
 * Database-backed login credentials — the Node-only half of auth.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `src/lib/auth.ts`:
 * `src/middleware.ts` imports `src/lib/auth.ts` and runs on the **Edge
 * runtime, where Prisma cannot run**. That file must therefore stay free of
 * Prisma — direct or transitive — or middleware crashes and nobody can log
 * in at all. This is workable because the session cookie is just an HMAC of
 * a role tag: verifying a session needs no database. Only *credential
 * checking at login* does, and the login route runs in Node.
 *
 * So: all DB work lives here, and this module is imported from
 * `src/app/api/auth/login/route.ts` and `scripts/manage-users.mjs` ONLY.
 * Never import it from `src/lib/auth.ts` or anything middleware reaches.
 *
 * Hashing: `node:crypto` scrypt with a random per-password salt — no new npm
 * dependency. The stored string is self-describing (`scrypt$salt$hash`) so
 * the format can evolve later without a migration.
 */

import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import type { SessionRole } from "@/lib/auth";

const SCHEME = "scrypt";
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/**
 * Hash a plaintext password for storage. Returns `scrypt$<saltHex>$<hashHex>`.
 * A fresh random salt per password means two users with the same password
 * never share a hash.
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, KEY_BYTES);
  return `${SCHEME}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * Constant-time verify against a stored hash string. Returns false — never
 * throws — for malformed, legacy, or truncated hash strings, so one bad row
 * can't 500 the login route.
 */
export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 3) return false;
    const [scheme, saltHex, hashHex] = parts;
    if (scheme !== SCHEME) return false;
    if (!saltHex || !hashHex) return false;
    if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) {
      return false;
    }
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    if (salt.length === 0 || expected.length === 0) return false;
    // The stored hash must be exactly the length we write (KEY_BYTES), not
    // merely non-empty.
    //
    // Deriving at `expected.length` — as this did before — means the STORED
    // ROW decides how many bytes get compared. scrypt finishes with
    // PBKDF2-HMAC-SHA256, whose output is prefix-consistent, so a hash
    // truncated to its first N bytes still verifies against the correct
    // password: the comparison silently weakens to N bytes. A row truncated
    // to one byte would accept roughly 1 in 256 passwords. Exploiting it
    // requires write access to the row (at which point an attacker could
    // simply store their own hash), so this is hardening rather than an open
    // hole — but a truncating bug or a partial restore must fail closed, not
    // quietly downgrade the check.
    //
    // A future scheme with a different key length gets a new SCHEME tag, so
    // pinning the length here does not block the self-describing format from
    // evolving.
    if (expected.length !== KEY_BYTES) return false;
    const actual = scryptSync(plain, salt, KEY_BYTES);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidRole(role: string): role is SessionRole {
  return role === "owner" || role === "reviewer";
}

/**
 * Look up an app login and verify its password.
 *
 * Returns the row's role on success, or null when: no such email, wrong
 * password, `disabledAt` is set (revoked), `expiresAt` is in the past
 * (self-revoking — the point of the reviewer account), or the stored role
 * isn't one this app understands.
 *
 * Callers must not distinguish these cases to the client — the login route
 * returns one generic 401 for all of them.
 */
export async function verifyUserCredentials(
  email: string,
  password: string,
): Promise<SessionRole | null> {
  const user = await prisma.appUser.findUnique({
    where: { email: normalizeEmail(email) },
  });
  if (!user) return null;
  if (user.disabledAt) return null;
  if (user.expiresAt && user.expiresAt.getTime() <= Date.now()) return null;
  if (!isValidRole(user.role)) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user.role;
}
