-- Track whether a sync pulled everything or filtered on updated_time.
--
-- Only a full pull can notice a DELETION, because Meta's updated_time filter
-- reports what changed and a deleted object simply stops appearing. The
-- reconcile schedule keys off this column.
--
-- Default true: every run predating incremental sync was a full pull, so the
-- backfilled value is factually correct, not just convenient.
ALTER TABLE "SyncLog" ADD COLUMN "fullPull" BOOLEAN NOT NULL DEFAULT true;

-- decideSyncMode reads the newest success and the newest full pull per
-- account and kind on every sync.
CREATE INDEX "SyncLog_adAccountId_kind_status_finishedAt_idx"
  ON "SyncLog" ("adAccountId", "kind", "status", "finishedAt");
