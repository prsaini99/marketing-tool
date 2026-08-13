import { describe, expect, it } from "vitest";
import {
  CUSTOM_RANGE_VALUE,
  insightsDateFilter,
  isoDay,
  resolveDateRange,
} from "@/lib/date-range";

const NOW = new Date("2026-08-13T10:30:00.000Z");

describe("presets", () => {
  it("defaults to 7 days for anything unrecognised", () => {
    for (const raw of [null, undefined, "", "nonsense", "1y"]) {
      expect(resolveDateRange(raw, null, null, NOW).value).toBe("7d");
    }
  });

  it("counts the window inclusively, so 7d starts 6 days back", () => {
    const r = resolveDateRange("7d", null, null, NOW);
    expect(isoDay(r.since!)).toBe("2026-08-07");
  });

  it("starts the lower bound at midnight UTC", () => {
    const r = resolveDateRange("30d", null, null, NOW);
    expect(r.since!.toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  it("leaves the upper bound open so a row written later today still counts", () => {
    expect(resolveDateRange("90d", null, null, NOW).until).toBeNull();
  });

  it("is unbounded on both sides for all time", () => {
    const r = resolveDateRange("all", null, null, NOW);
    expect(r.since).toBeNull();
    expect(r.until).toBeNull();
  });
});

describe("custom ranges", () => {
  it("resolves both bounds inclusively", () => {
    const r = resolveDateRange(CUSTOM_RANGE_VALUE, "2026-01-12", "2026-02-14", NOW);
    expect(r.since!.toISOString()).toBe("2026-01-12T00:00:00.000Z");
    expect(r.until!.toISOString()).toBe("2026-02-14T23:59:59.999Z");
  });

  it("includes the whole of the end day, not midnight on it", () => {
    // A row stamped 2026-02-14 must fall inside a range ending 2026-02-14.
    const r = resolveDateRange(CUSTOM_RANGE_VALUE, "2026-02-01", "2026-02-14", NOW);
    const row = new Date("2026-02-14T00:00:00.000Z");
    expect(row >= r.since!).toBe(true);
    expect(row <= r.until!).toBe(true);
  });

  it("swaps a reversed range rather than returning nothing", () => {
    const r = resolveDateRange(CUSTOM_RANGE_VALUE, "2026-02-14", "2026-01-12", NOW);
    expect(r.from).toBe("2026-01-12");
    expect(r.to).toBe("2026-02-14");
  });

  it("accepts a single day", () => {
    const r = resolveDateRange(CUSTOM_RANGE_VALUE, "2026-03-05", "2026-03-05", NOW);
    expect(r.label).toBe("5 Mar 2026");
    expect(r.since!.toISOString()).toBe("2026-03-05T00:00:00.000Z");
    expect(r.until!.toISOString()).toBe("2026-03-05T23:59:59.999Z");
  });

  it("falls back to the default when both bounds are missing", () => {
    // Otherwise "custom" with no dates would quietly mean "everything ever",
    // the one answer someone picking specific dates did not ask for.
    expect(resolveDateRange(CUSTOM_RANGE_VALUE, null, null, NOW).value).toBe("7d");
  });

  it("rejects a date that does not exist instead of rolling it over", () => {
    // new Date("2026-02-31") rolls into March. Accepting that would widen
    // the window past what the user selected, silently.
    const r = resolveDateRange(CUSTOM_RANGE_VALUE, "2026-02-31", null, NOW);
    expect(r.value).toBe("7d");
  });

  it("rejects malformed input", () => {
    for (const bad of ["2026-1-1", "13/08/2026", "yesterday", "2026-08-13T00:00:00Z"]) {
      expect(resolveDateRange(CUSTOM_RANGE_VALUE, bad, null, NOW).value).toBe("7d");
    }
  });

  it("supports an open-ended lower bound", () => {
    const r = resolveDateRange(CUSTOM_RANGE_VALUE, "2026-01-12", null, NOW);
    expect(r.since).not.toBeNull();
    expect(r.until).toBeNull();
    expect(r.label).toBe("From 12 Jan 2026");
  });
});

describe("insightsDateFilter", () => {
  it("is empty for an unbounded range, so nothing is filtered out", () => {
    expect(insightsDateFilter(resolveDateRange("all", null, null, NOW))).toEqual({});
  });

  it("emits only gte for a preset", () => {
    const f = insightsDateFilter(resolveDateRange("7d", null, null, NOW));
    expect(f.date?.gte).toBeInstanceOf(Date);
    expect(f.date?.lte).toBeUndefined();
  });

  it("emits both bounds for a custom range", () => {
    const f = insightsDateFilter(
      resolveDateRange(CUSTOM_RANGE_VALUE, "2026-01-12", "2026-02-14", NOW),
    );
    expect(f.date?.gte?.toISOString()).toBe("2026-01-12T00:00:00.000Z");
    expect(f.date?.lte?.toISOString()).toBe("2026-02-14T23:59:59.999Z");
  });
});
