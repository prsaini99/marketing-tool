-- AlterTable
ALTER TABLE "MetaAdAccount"
  ADD COLUMN "balanceCents" INTEGER,
  ADD COLUMN "spendCapCents" INTEGER,
  ADD COLUMN "amountSpentCents" INTEGER,
  ADD COLUMN "minDailyBudgetCents" INTEGER,
  ADD COLUMN "fundingSourceId" TEXT,
  ADD COLUMN "businessCountryCode" TEXT,
  ADD COLUMN "disableReason" TEXT,
  ADD COLUMN "healthSyncedAt" TIMESTAMP(3);
