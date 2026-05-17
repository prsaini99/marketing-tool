-- CreateTable
CREATE TABLE "CustomAudience" (
  "id" TEXT NOT NULL,
  "metaAudienceId" TEXT NOT NULL,
  "adAccountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subtype" TEXT,
  "description" TEXT,
  "approximateCount" INTEGER,
  "operationStatus" TEXT,
  "dataSourceSubtype" TEXT,
  "metaCreatedTime" TIMESTAMP(3),
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomAudience_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomAudience_adAccountId_metaAudienceId_key"
  ON "CustomAudience"("adAccountId", "metaAudienceId");

-- AddForeignKey
ALTER TABLE "CustomAudience"
  ADD CONSTRAINT "CustomAudience_adAccountId_fkey"
  FOREIGN KEY ("adAccountId") REFERENCES "MetaAdAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
