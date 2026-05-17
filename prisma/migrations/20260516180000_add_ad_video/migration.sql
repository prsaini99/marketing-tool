-- CreateTable
CREATE TABLE "AdVideo" (
  "id" TEXT NOT NULL,
  "metaVideoId" TEXT NOT NULL,
  "adAccountId" TEXT NOT NULL,
  "title" TEXT,
  "description" TEXT,
  "thumbnailUrl" TEXT,
  "sourceUrl" TEXT,
  "lengthSeconds" DOUBLE PRECISION,
  "status" TEXT,
  "metaCreatedTime" TIMESTAMP(3),
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdVideo_adAccountId_metaVideoId_key"
  ON "AdVideo"("adAccountId", "metaVideoId");

-- AddForeignKey
ALTER TABLE "AdVideo"
  ADD CONSTRAINT "AdVideo_adAccountId_fkey"
  FOREIGN KEY ("adAccountId") REFERENCES "MetaAdAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
