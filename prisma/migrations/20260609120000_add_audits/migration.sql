-- Persisted account audits — one row per Run audit click.
-- See prisma/schema.prisma `model Audit` for the contract.

CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowDays" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "findings" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "stats" JSONB NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- Latest-first lookup per account is THE primary access pattern (Audit
-- page loads the most-recent run). Composite covers both filter + order.
CREATE INDEX "Audit_adAccountId_runAt_idx"
    ON "Audit"("adAccountId", "runAt" DESC);

ALTER TABLE "Audit"
    ADD CONSTRAINT "Audit_adAccountId_fkey"
    FOREIGN KEY ("adAccountId") REFERENCES "MetaAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
