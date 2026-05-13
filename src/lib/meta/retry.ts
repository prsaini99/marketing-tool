/**
 * Retry wrapper for Meta API calls.
 *
 * Meta's API throws several classes of errors, only some of which should
 * be retried:
 *
 * - Code 1, 2: temporary server errors → retry with backoff
 * - Code 4, 17, 32, 613: rate limit hit → retry with longer backoff
 * - Code 190: token expired or invalid → DO NOT retry, surface to user
 * - Code 100: invalid parameter → DO NOT retry, this is our bug
 * - Network errors (ECONNRESET, ETIMEDOUT) → retry
 *
 * Reference: https://developers.facebook.com/docs/graph-api/guides/error-handling/
 */

const RETRYABLE_META_ERROR_CODES = new Set([1, 2, 4, 17, 32, 613]);
const FATAL_META_ERROR_CODES = new Set([100, 190, 200, 803]);

interface MetaError {
  response?: {
    error?: {
      code?: number;
      error_subcode?: number;
      message?: string;
    };
  };
  code?: string; // for network errors like ECONNRESET
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 1000;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!isRetryable(err) || attempt === maxAttempts) {
        throw normalizeError(err);
      }

      // exponential backoff with jitter
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw normalizeError(lastError);
}

function isRetryable(err: unknown): boolean {
  const e = err as MetaError;
  const metaCode = e.response?.error?.code;

  if (metaCode != null) {
    if (FATAL_META_ERROR_CODES.has(metaCode)) return false;
    if (RETRYABLE_META_ERROR_CODES.has(metaCode)) return true;
    return false;
  }

  // Network-level retries
  if (e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT') return true;

  return false;
}

function normalizeError(err: unknown): Error {
  const e = err as MetaError;
  const metaError = e.response?.error;

  if (metaError) {
    const normalized = new Error(metaError.message ?? 'Meta API error');
    (normalized as any).metaCode = metaError.code;
    (normalized as any).metaSubcode = metaError.error_subcode;
    return normalized;
  }

  return err instanceof Error ? err : new Error(String(err));
}
