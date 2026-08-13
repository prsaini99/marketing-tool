-- Durable storage for Meta creative assets.
--
-- Meta's fna.fbcdn.net URLs stop resolving within about a day (the edge
-- appliance is retired and its hostname leaves global DNS), so the bytes are
-- captured during sync while the URL is still live. These columns record
-- where they landed.
--
-- storedAt vs storeAttemptedAt is the important pair: it lets a sync retry
-- only the assets whose capture failed, rather than re-attempting the entire
-- library on every run.
--
-- Hand-written rather than generated. `prisma migrate diff` also wanted to
-- DROP INDEX "Embedding_vector_hnsw_idx" -- the pgvector index built in raw
-- SQL, which Prisma cannot see in the datamodel and therefore reads as
-- drift. Applying the generated script would have quietly removed it.

ALTER TABLE "AdImage"
  ADD COLUMN "storagePath"      TEXT,
  ADD COLUMN "storedAt"         TIMESTAMP(3),
  ADD COLUMN "storeAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "storeError"       TEXT;

ALTER TABLE "AdVideo"
  ADD COLUMN "storagePath"      TEXT,
  ADD COLUMN "storedAt"         TIMESTAMP(3),
  ADD COLUMN "storeAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "storeError"       TEXT;

ALTER TABLE "AdCreative"
  ADD COLUMN "storagePath"      TEXT,
  ADD COLUMN "storedAt"         TIMESTAMP(3),
  ADD COLUMN "storeAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "storeError"       TEXT;

-- Find the retry backlog without scanning the whole table.
CREATE INDEX "AdImage_storagePath_idx"    ON "AdImage"    ("storagePath");
CREATE INDEX "AdVideo_storagePath_idx"    ON "AdVideo"    ("storagePath");
CREATE INDEX "AdCreative_storagePath_idx" ON "AdCreative" ("storagePath");
