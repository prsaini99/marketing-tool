-- Expand the Alert + Ad models for ad-set / policy / audience-overlap alerts.

-- Ad: capture Meta's real delivery status + the issues array driving any
-- WITH_ISSUES / DISAPPROVED state. Powers the policy alert.
ALTER TABLE "Ad"
    ADD COLUMN "effectiveStatus" TEXT,
    ADD COLUMN "issuesInfo" JSONB;

-- Alert: identify the entity an alert is about (ad-set, ad, audience pair)
-- so multiple per account can coexist on the same day with the same kind.
ALTER TABLE "Alert"
    ADD COLUMN "entityType" TEXT NOT NULL DEFAULT 'account',
    ADD COLUMN "entityId" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "entityName" TEXT;

-- Swap the unique constraint to include entityId so e.g. two ad-sets can
-- both have an `adset_spend_drop` on the same date without colliding.
ALTER TABLE "Alert" DROP CONSTRAINT IF EXISTS "Alert_adAccountId_forDate_kind_key";
DROP INDEX IF EXISTS "Alert_adAccountId_forDate_kind_key";

CREATE UNIQUE INDEX "Alert_adAccountId_forDate_kind_entityId_key"
    ON "Alert"("adAccountId", "forDate", "kind", "entityId");
