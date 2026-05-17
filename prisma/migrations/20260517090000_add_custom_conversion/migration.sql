-- CreateTable
CREATE TABLE "CustomConversion" (
  "id" TEXT NOT NULL,
  "metaConversionId" TEXT NOT NULL,
  "adAccountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "rule" TEXT,
  "customEventType" TEXT,
  "eventSourceId" TEXT,
  "metaLastFiredTime" TIMESTAMP(3),
  "metaCreatedTime" TIMESTAMP(3),
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomConversion_adAccountId_metaConversionId_key"
  ON "CustomConversion"("adAccountId", "metaConversionId");

-- AddForeignKey
ALTER TABLE "CustomConversion"
  ADD CONSTRAINT "CustomConversion_adAccountId_fkey"
  FOREIGN KEY ("adAccountId") REFERENCES "MetaAdAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
