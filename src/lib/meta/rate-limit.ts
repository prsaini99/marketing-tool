/**
 * Per-account Meta API rate-limit tracking.
 *
 * Phase 0: no-op. With one account and one user, we won't hit Meta's per-account
 * limits. Real implementation arrives if/when we add Redis (likely Phase 2+
 * when bulk operations land).
 *
 * Keep this stub so `client.ts` can call it unconditionally — switching to a
 * real implementation later is a one-file change, not a refactor across the app.
 */

// The parameter is deliberately unused: it stays in the signature so callers
// already pass what the real implementation will need, making the swap a
// one-file change. eslint-disable rather than deleting the arg.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function checkRateLimit(credentialId: string): Promise<void> {
  return;
}
