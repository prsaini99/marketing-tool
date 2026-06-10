-- Daily-anomaly digest rows for the Alerts page (/dashboard/alerts).
-- See prisma/schema.prisma `model Alert` for the contract.
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "severity" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- De-dupe: re-running the scan for the same account/day/kind upserts in
-- place rather than creating a fresh row.
CREATE UNIQUE INDEX "Alert_adAccountId_forDate_kind_key"
    ON "Alert"("adAccountId", "forDate", "kind");

-- Sidebar badge counts dismissed vs not; this index makes the filter cheap.
CREATE INDEX "Alert_dismissedAt_idx" ON "Alert"("dismissedAt");

-- Listing on the Alerts page is "newest first".
CREATE INDEX "Alert_createdAt_idx" ON "Alert"("createdAt" DESC);

ALTER TABLE "Alert"
    ADD CONSTRAINT "Alert_adAccountId_fkey"
    FOREIGN KEY ("adAccountId") REFERENCES "MetaAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
