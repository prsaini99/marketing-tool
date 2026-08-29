CREATE TABLE "VideoGeneration" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "formatId" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "negativePrompt" TEXT,
    "aspectRatio" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "requestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "storagePath" TEXT,
    "storedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoGeneration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VideoGeneration_businessId_createdAt_idx" ON "VideoGeneration"("businessId", "createdAt");
CREATE INDEX "VideoGeneration_status_idx" ON "VideoGeneration"("status");

ALTER TABLE "VideoGeneration" ADD CONSTRAINT "VideoGeneration_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "MetaBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;
