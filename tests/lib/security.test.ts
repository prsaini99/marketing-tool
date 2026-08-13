/**
 * Security-critical pure helpers: password hashing/verification and Meta
 * webhook signature verification.
 *
 * Both are written to FAIL CLOSED and to never throw — a malformed stored
 * hash or a malformed signature header must return false, not 500 the
 * login route or the webhook endpoint. Those properties are what these
 * tests pin down.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/services/auth/users";
import { verifyWebhookSignature } from "@/lib/meta/webhooks";

describe("hashPassword / verifyPassword", () => {
  it("round-trips a correct password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("hunter2");
    expect(verifyPassword("hunter3", stored)).toBe(false);
  });

  it("produces the documented scrypt$salt$hash shape", () => {
    const parts = hashPassword("x").split("$");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toMatch(/^[0-9a-f]+$/);
    expect(parts[2]).toMatch(/^[0-9a-f]+$/);
  });

  it("salts each hash so identical passwords differ", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("returns false — never throws — for malformed stored hashes", () => {
    // One bad row must not be able to 500 the login route.
    for (const bad of [
      "",
      "nonsense",
      "scrypt$onlytwo",
      "scrypt$$",
      "bcrypt$aa$bb",
      "scrypt$zz$hash", // non-hex salt
      "scrypt$aa$zz", // non-hex hash
      "scrypt$aa$", // empty hash
    ]) {
      expect(() => verifyPassword("x", bad)).not.toThrow();
      expect(verifyPassword("x", bad), bad).toBe(false);
    }
  });

  it("is not fooled by a truncated hash of the right prefix", () => {
    const stored = hashPassword("secret");
    const [scheme, salt, hash] = stored.split("$");
    const truncated = `${scheme}$${salt}$${hash.slice(0, 32)}`;
    expect(verifyPassword("secret", truncated)).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "app-secret";
  const body = JSON.stringify({ object: "page", entry: [] });
  const valid =
    "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");

  it("accepts a correctly signed body", () => {
    expect(verifyWebhookSignature(body, valid, secret)).toBe(true);
  });

  it("rejects a body that was tampered with", () => {
    expect(verifyWebhookSignature(body + " ", valid, secret)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const other =
      "sha256=" +
      createHmac("sha256", "wrong").update(body, "utf8").digest("hex");
    expect(verifyWebhookSignature(body, other, secret)).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWebhookSignature(body, "", secret)).toBe(false);
    expect(verifyWebhookSignature(body, "sha1=abc", secret)).toBe(false);
    expect(verifyWebhookSignature(body, valid.slice(7), secret)).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    // timingSafeEqual throws on length mismatch; the guard must catch it.
    expect(() =>
      verifyWebhookSignature(body, "sha256=deadbeef", secret),
    ).not.toThrow();
    expect(verifyWebhookSignature(body, "sha256=deadbeef", secret)).toBe(false);
  });
});
