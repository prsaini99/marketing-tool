import { describe, expect, it } from "vitest";
import {
  decideSyncMode,
  FULL_SYNC_INTERVAL_MS,
} from "@/server/services/sync/watermark";

const NOW = new Date("2026-08-13T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("decideSyncMode", () => {
  it("pulls everything when nothing has ever synced", () => {
    const m = decideSyncMode({ lastSuccessAt: null, lastFullAt: null }, NOW);
    expect(m).toMatchObject({ full: true, since: null, reason: "first-sync" });
  });

  it("pulls everything when a sync exists but no full pull was recorded", () => {
    // Accounts synced before full-pull tracking existed have no trustworthy
    // watermark. Filtering from one would silently skip everything older.
    const m = decideSyncMode(
      { lastSuccessAt: ago(60_000), lastFullAt: null },
      NOW,
    );
    expect(m.full).toBe(true);
    expect(m.reason).toBe("first-sync");
  });

  it("goes incremental from the last success when a recent full pull exists", () => {
    const last = ago(60 * 60 * 1000);
    const m = decideSyncMode({ lastSuccessAt: last, lastFullAt: ago(2 * 60 * 60 * 1000) }, NOW);
    expect(m.full).toBe(false);
    expect(m.since).toEqual(last);
    expect(m.reason).toBe("incremental");
  });

  it("forces a full pull once the reconcile interval has elapsed", () => {
    // This is the only thing that removes objects deleted on Meta, since an
    // updated_time filter can never report a deletion.
    const m = decideSyncMode(
      { lastSuccessAt: ago(60_000), lastFullAt: ago(FULL_SYNC_INTERVAL_MS + 1000) },
      NOW,
    );
    expect(m.full).toBe(true);
    expect(m.reason).toBe("reconcile-due");
  });

  it("stays incremental right up to the interval boundary", () => {
    const m = decideSyncMode(
      { lastSuccessAt: ago(60_000), lastFullAt: ago(FULL_SYNC_INTERVAL_MS - 1000) },
      NOW,
    );
    expect(m.full).toBe(false);
  });

  it("honours an explicit full pull regardless of history", () => {
    const m = decideSyncMode(
      { lastSuccessAt: ago(60_000), lastFullAt: ago(60_000) },
      NOW,
      { forceFull: true },
    );
    expect(m.full).toBe(true);
    expect(m.since).toBeNull();
  });
});
