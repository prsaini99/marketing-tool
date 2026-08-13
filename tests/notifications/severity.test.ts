/**
 * The severity floor decides what is worth an email.
 *
 * The property worth pinning: an UNKNOWN severity must still be delivered
 * when the floor is permissive. A new alert kind shipping with a severity
 * string this list hasn't seen yet should be noisy, not silently undeliverable
 * — a missing alert is invisible, and invisibility is the failure mode this
 * whole feature exists to fix.
 */

import { describe, expect, it } from "vitest";
import { meetsSeverityFloor } from "@/server/services/notifications/alert-digest";

describe("meetsSeverityFloor", () => {
  it("passes anything at or above the floor", () => {
    expect(meetsSeverityFloor("high", "medium")).toBe(true);
    expect(meetsSeverityFloor("medium", "medium")).toBe(true);
  });

  it("blocks anything below the floor", () => {
    expect(meetsSeverityFloor("low", "medium")).toBe(false);
    expect(meetsSeverityFloor("info", "medium")).toBe(false);
    expect(meetsSeverityFloor("medium", "high")).toBe(false);
  });

  it("passes everything when the floor is low", () => {
    for (const s of ["high", "medium", "low"]) {
      expect(meetsSeverityFloor(s, "low"), s).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(meetsSeverityFloor("HIGH", "medium")).toBe(true);
    expect(meetsSeverityFloor("high", "MEDIUM")).toBe(true);
  });

  it("delivers an unrecognised severity when the floor is unrecognised too", () => {
    // Both sort last, so they compare equal — the new kind still gets out.
    expect(meetsSeverityFloor("catastrophic", "catastrophic")).toBe(true);
  });

  it("holds back an unrecognised severity under a known floor", () => {
    // Conservative: an unknown string is treated as least-severe, so a
    // "medium and above" subscriber isn't surprised by it.
    expect(meetsSeverityFloor("catastrophic", "high")).toBe(false);
  });
});
