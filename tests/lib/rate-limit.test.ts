import { describe, expect, it } from "vitest";
import { clientIpFrom, createRateLimiter } from "@/lib/rate-limit";

const WINDOW = 15 * 60 * 1000;
const T0 = 1_700_000_000_000;

function limiter(limit = 3, windowMs = WINDOW, maxKeys?: number) {
  return createRateLimiter({ limit, windowMs, maxKeys });
}

describe("createRateLimiter", () => {
  it("allows exactly `limit` attempts, then blocks", () => {
    const rl = limiter(3);
    expect(rl.check("ip", T0).allowed).toBe(true);
    expect(rl.check("ip", T0 + 1).allowed).toBe(true);
    expect(rl.check("ip", T0 + 2).allowed).toBe(true);
    expect(rl.check("ip", T0 + 3).allowed).toBe(false);
  });

  it("reports remaining attempts counting down to zero", () => {
    const rl = limiter(3);
    expect(rl.check("ip", T0).remaining).toBe(2);
    expect(rl.check("ip", T0).remaining).toBe(1);
    expect(rl.check("ip", T0).remaining).toBe(0);
    expect(rl.check("ip", T0).remaining).toBe(0);
  });

  it("keys are independent, so one IP cannot lock out another", () => {
    const rl = limiter(2);
    rl.check("a", T0);
    rl.check("a", T0);
    expect(rl.check("a", T0).allowed).toBe(false);
    expect(rl.check("b", T0).allowed).toBe(true);
  });

  it("slides: an attempt leaving the window frees a slot", () => {
    const rl = limiter(2);
    rl.check("ip", T0);
    rl.check("ip", T0 + 1000);
    expect(rl.check("ip", T0 + 2000).allowed).toBe(false);

    // The first attempt is now outside the window, the second is not.
    const justAfterFirstExpires = T0 + WINDOW + 1;
    expect(rl.check("ip", justAfterFirstExpires).allowed).toBe(true);
    expect(rl.check("ip", justAfterFirstExpires).allowed).toBe(false);
  });

  it("retryAfterSeconds counts to the oldest attempt leaving the window", () => {
    const rl = limiter(1);
    rl.check("ip", T0);
    const blocked = rl.check("ip", T0 + 60_000);
    // 15 min window, 1 min elapsed, so 14 min left.
    expect(blocked.retryAfterSeconds).toBe(14 * 60);
  });

  it("never reports a retryAfter below one second", () => {
    const rl = limiter(1);
    rl.check("ip", T0);
    // 1ms before the window closes: rounds to 1, not 0, so a Retry-After
    // header can never tell a client to retry immediately.
    const blocked = rl.check("ip", T0 + WINDOW - 1);
    expect(blocked.retryAfterSeconds).toBe(1);
  });

  it("does not extend the lockout when a blocked caller keeps hammering", () => {
    const rl = limiter(2);
    rl.check("ip", T0);
    rl.check("ip", T0);

    // Hammer throughout the window. If blocked attempts were recorded, the
    // window would keep sliding forward and the caller would never recover.
    for (let t = T0; t < T0 + WINDOW; t += 1000) {
      expect(rl.check("ip", t).allowed).toBe(false);
    }

    expect(rl.check("ip", T0 + WINDOW + 1).allowed).toBe(true);
  });

  it("reset clears a key immediately", () => {
    const rl = limiter(1);
    rl.check("ip", T0);
    expect(rl.check("ip", T0).allowed).toBe(false);
    rl.reset("ip");
    expect(rl.check("ip", T0).allowed).toBe(true);
  });

  it("never grows past the key cap", () => {
    const rl = limiter(5, WINDOW, 10);
    for (let i = 0; i < 50; i++) rl.check(`ip-${i}`, T0 + i);
    expect(rl.size()).toBeLessThanOrEqual(10);
  });

  it("reclaims expired keys ahead of evicting live ones", () => {
    const rl = limiter(5, WINDOW, 10);
    for (let i = 0; i < 11; i++) rl.check(`old-${i}`, T0 + i);

    // A full window later, every `old-*` key is stale. Adding fresh keys
    // trips the sweep, which must take the stale ones rather than the new.
    const later = T0 + WINDOW + 1;
    for (let i = 0; i < 11; i++) rl.check(`new-${i}`, later + i);

    expect(rl.size()).toBeLessThanOrEqual(10);
    // old-0 was forgotten, so it gets a full allowance again.
    expect(rl.check("old-0", later + 20).remaining).toBe(4);
  });

  it("evicts least-recently-seen keys when live keys exceed the cap", () => {
    const rl = limiter(5, WINDOW, 10);
    for (let i = 0; i < 40; i++) rl.check(`ip-${i}`, T0 + i);
    expect(rl.size()).toBeLessThanOrEqual(11);
    // The most recent key survives the squeeze.
    expect(rl.check("ip-39", T0 + 40).remaining).toBe(3);
  });
});

describe("clientIpFrom", () => {
  it("takes the first entry of x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" });
    expect(clientIpFrom(h)).toBe("203.0.113.7");
  });

  it("trims whitespace around the client entry", () => {
    const h = new Headers({ "x-forwarded-for": "  203.0.113.7 , 70.41.3.18" });
    expect(clientIpFrom(h)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    const h = new Headers({ "x-real-ip": "198.51.100.4" });
    expect(clientIpFrom(h)).toBe("198.51.100.4");
  });

  it("returns 'unknown' when no proxy header is present", () => {
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });

  it("returns 'unknown' rather than an empty key for a blank header", () => {
    // An empty bucket name would collide with nothing and effectively opt the
    // caller out of throttling, so it must not be reachable.
    const h = new Headers({ "x-forwarded-for": "  " });
    expect(clientIpFrom(h)).toBe("unknown");
  });
});
