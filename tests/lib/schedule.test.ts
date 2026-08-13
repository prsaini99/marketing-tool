/**
 * Schedule maths — the single source of truth shared by the schedules UI
 * and the cron tick. Every result must be strictly in the future and on a
 * stable UTC boundary, so that two accounts saved at different times still
 * fire together rather than drifting apart.
 */

import { describe, expect, it } from "vitest";
import {
  callsPerDay,
  computeNextRun,
  frequencyLabel,
  isFrequencyKey,
} from "@/lib/schedule";

const at = (iso: string) => new Date(iso);

describe("computeNextRun", () => {
  it("returns null when the schedule is off", () => {
    expect(computeNextRun("off", at("2026-08-12T10:15:00Z"))).toBe(null);
  });

  it("hourly rolls to the next whole hour", () => {
    expect(
      computeNextRun("hourly", at("2026-08-12T10:15:30Z"))?.toISOString(),
    ).toBe("2026-08-12T11:00:00.000Z");
  });

  it("hourly on an exact hour still moves forward, never returns now", () => {
    expect(
      computeNextRun("hourly", at("2026-08-12T10:00:00Z"))?.toISOString(),
    ).toBe("2026-08-12T11:00:00.000Z");
  });

  it("every_6h lands on a 6-hour UTC boundary", () => {
    expect(
      computeNextRun("every_6h", at("2026-08-12T10:15:00Z"))?.toISOString(),
    ).toBe("2026-08-12T12:00:00.000Z");
    expect(
      computeNextRun("every_6h", at("2026-08-12T00:05:00Z"))?.toISOString(),
    ).toBe("2026-08-12T06:00:00.000Z");
  });

  it("every_6h past 18:00 rolls into the next day", () => {
    const next = computeNextRun("every_6h", at("2026-08-12T19:30:00Z"));
    expect(next?.toISOString()).toBe("2026-08-13T00:00:00.000Z");
  });

  it("daily anchors to 02:00 UTC", () => {
    expect(
      computeNextRun("daily", at("2026-08-12T00:30:00Z"))?.toISOString(),
    ).toBe("2026-08-12T02:00:00.000Z");
  });

  it("daily after 02:00 moves to tomorrow", () => {
    expect(
      computeNextRun("daily", at("2026-08-12T09:00:00Z"))?.toISOString(),
    ).toBe("2026-08-13T02:00:00.000Z");
  });

  it("weekly lands on a Sunday at 02:00 UTC", () => {
    const next = computeNextRun("weekly", at("2026-08-12T09:00:00Z"));
    expect(next?.getUTCDay()).toBe(0);
    expect(next?.getUTCHours()).toBe(2);
    expect(next!.getTime()).toBeGreaterThan(at("2026-08-12T09:00:00Z").getTime());
  });

  it("every_3d aligns to a shared anchor, not to when it was saved", () => {
    // Two accounts configured hours apart must converge on the same slot.
    const a = computeNextRun("every_3d", at("2026-08-12T03:00:00Z"));
    const b = computeNextRun("every_3d", at("2026-08-12T20:00:00Z"));
    expect(a?.toISOString()).toBe(b?.toISOString());
  });

  it("every frequency returns a time strictly in the future", () => {
    const now = at("2026-08-12T02:00:00Z"); // deliberately on a boundary
    for (const f of ["hourly", "every_6h", "daily", "every_3d", "weekly"] as const) {
      const next = computeNextRun(f, now);
      expect(next, f).not.toBe(null);
      expect(next!.getTime(), f).toBeGreaterThan(now.getTime());
    }
  });
});

describe("frequency helpers", () => {
  it("recognises valid keys and rejects junk", () => {
    expect(isFrequencyKey("daily")).toBe(true);
    expect(isFrequencyKey("off")).toBe(true);
    expect(isFrequencyKey("yearly")).toBe(false);
    expect(isFrequencyKey(undefined)).toBe(false);
    expect(isFrequencyKey(null)).toBe(false);
  });

  it("labels known keys and falls back to the raw key", () => {
    expect(frequencyLabel("daily")).toBe("Daily");
    expect(frequencyLabel("nonsense" as never)).toBe("nonsense");
  });
});

describe("callsPerDay", () => {
  it("charges insights 4 calls per run (one per level)", () => {
    expect(callsPerDay("insights", "daily")).toBe(4);
    expect(callsPerDay("campaigns", "daily")).toBe(1);
  });

  it("scales with frequency", () => {
    expect(callsPerDay("campaigns", "hourly")).toBe(24);
    expect(callsPerDay("insights", "hourly")).toBe(96);
  });

  it("costs nothing when off", () => {
    expect(callsPerDay("insights", "off")).toBe(0);
  });
});
