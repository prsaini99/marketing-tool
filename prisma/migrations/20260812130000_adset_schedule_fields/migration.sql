-- AlterTable
ALTER TABLE "AdSet"
  ADD COLUMN "effectiveStatus" TEXT,
  ADD COLUMN "startTime" TIMESTAMP(3),
  ADD COLUMN "endTime" TIMESTAMP(3),
  ADD COLUMN "budgetRemainingCents" INTEGER;
