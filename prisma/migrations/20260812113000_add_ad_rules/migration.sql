-- CreateTable
CREATE TABLE "AdRule" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scope" TEXT NOT NULL,
    "entityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metric" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 3,
    "minSpendCents" INTEGER NOT NULL DEFAULT 100000,
    "action" TEXT NOT NULL,
    "cooldownHours" INTEGER NOT NULL DEFAULT 24,
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdRule_adAccountId_enabled_idx" ON "AdRule"("adAccountId", "enabled");

-- AddForeignKey
ALTER TABLE "AdRule" ADD CONSTRAINT "AdRule_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "MetaAdAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
