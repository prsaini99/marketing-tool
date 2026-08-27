CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "palette" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "themeNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrandKit_businessId_key" ON "BrandKit"("businessId");

ALTER TABLE "BrandKit" ADD CONSTRAINT "BrandKit_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "MetaBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BrandAsset" (
    "id" TEXT NOT NULL,
    "brandKitId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrandAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BrandAsset_brandKitId_kind_idx" ON "BrandAsset"("brandKitId", "kind");

ALTER TABLE "BrandAsset" ADD CONSTRAINT "BrandAsset_brandKitId_fkey"
  FOREIGN KEY ("brandKitId") REFERENCES "BrandKit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
