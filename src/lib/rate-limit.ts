/**
 * Sliding-window rate limiter, in memory.
 *
 * Built for /api/auth/login, which sits outside the session middleware by
 * necessity and guards a single master password. Without a limiter, an
 * attacker gets unlimited guesses at one credential over the public
 * internet.
 *
 * NOT the same thing as src/lib/meta/rate-limit.ts, which is a stub for
 * staying inside Meta's Graph API quota. This one throttles inbound requests
 * to us.
 *
 * HONEST LIMITATION: state lives in module scope, so each serverless instance
 * counts independently. A distributed attacker hitting several warm instances
 * gets roughly limit x instances attempts per window, and a cold start resets
 * a counter. That makes this a speed bump, not a wall. It is chosen anyway
 * because it needs no new vendor and stops the realistic case, which is a
 * single host hammering one endpoint. If login ever becomes a real target,
 * swap the store for Redis or Postgres behind the same interface; the call
 * site does not change.
 *
 * The core is pure: `now` is passed in rather than read from the clock, so
 * tests can drive time directly instead of sleeping.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts left in the current window. 0 once blocked. */
  remaining: number;
  /**
   * Seconds until the oldest attempt falls out of the window, i.e. when the
   * caller may retry. 0 when allowed. Suitable for a Retry-After header.
   */
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  /** Attempts permitted inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Hard ceiling on tracked keys, so a flood of unique IPs cannot grow the
   * map without bound. When exceeded, expired keys are dropped first; if
   * that is not enough, the least recently seen keys go.
   */
  maxKeys?: number;
}

export interface RateLimiter {
  /** Records an attempt for `key` and reports whether it is permitted. */
  check(key: string, now: number): RateLimitResult;
  /** Forgets `key` entirely. Call after a successful login. */
  reset(key: string): void;
  /** Tracked key count. Exposed for tests and diagnostics. */
  size(): number;
}

const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = opts;
  const maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;

  // key -> timestamps of attempts still inside the window, oldest first.
  const hits = new Map<string, number[]>();

  function evictIfNeeded(now: number): void {
    if (hits.size <= maxKeys) return;

    for (const [key, times] of hits) {
      const newest = times[times.length - 1];
      if (newest === undefined || now - newest >= windowMs) hits.delete(key);
    }
    if (hits.size <= maxKeys) return;

    // Still over budget, so this is a genuine flood of live keys rather than
    // accumulated junk. Map preserves insertion order and every surviving
    // entry was re-inserted when last touched, so the front of the iterator
    // is the least recently seen.
    const excess = hits.size - maxKeys;
    let dropped = 0;
    for (const key of hits.keys()) {
      hits.delete(key);
      if (++dropped >= excess) break;
    }
  }

  return {
    check(key: string, now: number): RateLimitResult {
      const cutoff = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

      if (recent.length >= limit) {
        // Blocked. Deliberately do NOT record this attempt: counting blocked
        // requests would let someone keep their own lockout alive forever by
        // continuing to hammer, turning a cooldown into a permanent ban that
        // also locks out the legitimate owner sharing that IP.
        const oldest = recent[0];
        // Re-insert so this key counts as recently seen for eviction order.
        hits.delete(key);
        hits.set(key, recent);
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((oldest + windowMs - now) / 1000),
          ),
        };
      }

      recent.push(now);
      hits.delete(key);
      hits.set(key, recent);
      evictIfNeeded(now);

      return {
        allowed: true,
        remaining: limit - recent.length,
        retryAfterSeconds: 0,
      };
    },

    reset(key: string): void {
      hits.delete(key);
    },

    size(): number {
      return hits.size;
    },
  };
}

/**
 * Best-effort client IP from proxy headers.
 *
 * On Vercel, `x-forwarded-for` is set by the edge and its first entry is the
 * real client. The header is spoofable in general, but only where an attacker
 * can reach the app without passing through the proxy that overwrites it,
 * which is not the case for a Vercel deployment.
 *
 * Returns "unknown" when no header is present. Every such request then shares
 * one bucket, which errs toward throttling rather than toward letting an
 * unidentifiable caller through unlimited.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
