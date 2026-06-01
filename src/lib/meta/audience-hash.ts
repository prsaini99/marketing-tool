/**
 * Hashing helpers for Custom Audience customer-list uploads.
 *
 * Meta requires PII (emails, phones) to be normalized then SHA-256 hashed
 * before upload — raw PII must never leave the server. We do all of this
 * server-side: the browser sends plaintext over HTTPS to our API, we hash
 * here, and only hashes go to Meta. Nothing is persisted.
 *
 * Normalization rules follow Meta's spec
 * (developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences#hash):
 *   • Email — trim, lowercase, then SHA-256.
 *   • Phone — strip everything except digits (keep country code), then
 *     SHA-256. We do NOT add a default country code; callers should include
 *     it (Meta matches far better with it).
 */

import { createHash } from "crypto";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Normalize + hash a single email. Returns null for blanks / non-emails. */
export function hashEmail(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  // Cheap sanity check — must look like an email. Avoids hashing junk lines.
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }
  return sha256Hex(normalized);
}

/** Normalize + hash a single phone. Returns null if no digits remain. */
export function hashPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  // Meta wants at least a plausible number; 7 digits is a loose floor.
  if (digits.length < 7) return null;
  return sha256Hex(digits);
}

/**
 * Parse a free-text blob (newline / comma / semicolon separated) into a list
 * of hashed values, dropping anything that doesn't validate. Returns both
 * the hashes and the count of skipped lines so the UI can report
 * "42 added, 3 skipped".
 */
export function hashContactBlob(
  blob: string,
  kind: "email" | "phone",
): { hashes: string[]; skipped: number } {
  const tokens = blob
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const hashFn = kind === "email" ? hashEmail : hashPhone;
  const hashes: string[] = [];
  let skipped = 0;
  for (const t of tokens) {
    const h = hashFn(t);
    if (h) hashes.push(h);
    else skipped++;
  }
  // De-dupe — Meta counts duplicates against your upload size for no benefit.
  const unique = Array.from(new Set(hashes));
  return { hashes: unique, skipped };
}
