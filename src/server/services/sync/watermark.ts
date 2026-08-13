/**
 * Decides whether a sync runs incrementally or pulls everything.
 *
 * THE TRADE. Meta's `updated_time` filter makes a routine sync cheap: on a
 * quiet account it returns nothing instead of 200 campaigns. What it can
 * never do is report a DELETION, because a deleted object simply stops
 * appearing in the list. A mirror fed only by incremental pulls therefore
 * accumulates campaigns, ad sets and ads that no longer exist on Meta, and
 * nothing about that failure is visible: the rows look completely normal.
 *
 * So incremental syncs are the common path and a full pull is forced
 * periodically to reconcile. FULL_SYNC_INTERVAL_MS is the longest a deleted
 * object can linger in the dashboard.
 *
 * Pure and clock-injectable, so the policy is testable without a database.
 */

/** Longest a deleted Meta object may survive in the mirror. */
export const FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface SyncHistory {
  /** Last successful sync of this kind, incremental or full. */
  lastSuccessAt: Date | null;
  /** Last sync of this kind that pulled everything. */
  lastFullAt: Date | null;
}

export interface SyncMode {
  /** Watermark to filter on, or null to pull everything. */
  since: Date | null;
  full: boolean;
  /** Why, for the sync log. Silent mode switches are hard to debug. */
  reason: "first-sync" | "reconcile-due" | "incremental";
}

export function decideSyncMode(
  history: SyncHistory,
  now: Date = new Date(),
  opts: { forceFull?: boolean } = {},
): SyncMode {
  if (opts.forceFull) {
    return { since: null, full: true, reason: "reconcile-due" };
  }
  // Never synced, or synced before full-pull tracking existed. Either way
  // there is no trustworthy watermark, so take everything.
  if (!history.lastSuccessAt || !history.lastFullAt) {
    return { since: null, full: true, reason: "first-sync" };
  }
  if (now.getTime() - history.lastFullAt.getTime() >= FULL_SYNC_INTERVAL_MS) {
    return { since: null, full: true, reason: "reconcile-due" };
  }
  return { since: history.lastSuccessAt, full: false, reason: "incremental" };
}
