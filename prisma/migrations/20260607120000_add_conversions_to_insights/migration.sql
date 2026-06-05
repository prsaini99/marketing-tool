-- Conversion events + revenue on InsightsSnapshot. Powers ROAS in
-- reports, AI Assistant tools, and anomaly detection.
-- See prisma/schema.prisma `model InsightsSnapshot` for the contract.
ALTER TABLE "InsightsSnapshot"
    ADD COLUMN "conversionsCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "revenueCents" INTEGER NOT NULL DEFAULT 0;
