-- CreateTable
CREATE TABLE "AdCreative" (
  "id" TEXT NOT NULL,
  "metaCreativeId" TEXT NOT NULL,
  "adAccountId" TEXT NOT NULL,
  "name" TEXT,
  "body" TEXT,
  "title" TEXT,
  "linkUrl" TEXT,
  "imageUrl" TEXT,
  "imageHash" TEXT,
  "thumbnailUrl" TEXT,
  "videoId" TEXT,
  "callToActionType" TEXT,
  "status" TEXT,
  "effectiveStoryId" TEXT,
  "pageId" TEXT,
  "instagramActorId" TEXT,
  "objectType" TEXT,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdCreative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdCreative_adAccountId_metaCreativeId_key"
  ON "AdCreative"("adAccountId", "metaCreativeId");

-- AddForeignKey
ALTER TABLE "AdCreative"
  ADD CONSTRAINT "AdCreative_adAccountId_fkey"
  FOREIGN KEY ("adAccountId") REFERENCES "MetaAdAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
