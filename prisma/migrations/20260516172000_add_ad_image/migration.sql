-- CreateTable
CREATE TABLE "AdImage" (
  "id" TEXT NOT NULL,
  "metaImageHash" TEXT NOT NULL,
  "adAccountId" TEXT NOT NULL,
  "url" TEXT,
  "name" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "status" TEXT,
  "metaCreatedTime" TIMESTAMP(3),
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdImage_adAccountId_metaImageHash_key"
  ON "AdImage"("adAccountId", "metaImageHash");

-- AddForeignKey
ALTER TABLE "AdImage"
  ADD CONSTRAINT "AdImage_adAccountId_fkey"
  FOREIGN KEY ("adAccountId") REFERENCES "MetaAdAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
