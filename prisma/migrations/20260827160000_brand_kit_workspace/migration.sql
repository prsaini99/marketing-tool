-- A BrandKit with businessId IS NULL is the workspace's own kit: the one
-- edited with "All clients" selected, belonging to the operator rather
-- than to any client.
ALTER TABLE "BrandKit" ALTER COLUMN "businessId" DROP NOT NULL;

-- Postgres lets NULLs repeat under a plain unique constraint, so
-- BrandKit_businessId_key alone would permit any number of workspace
-- kits. This partial index pins it to exactly one while leaving the
-- per-client uniqueness (and the cascade FK) untouched.
CREATE UNIQUE INDEX "BrandKit_workspace_singleton"
  ON "BrandKit" (("businessId" IS NULL))
  WHERE "businessId" IS NULL;

-- Identity copy: brandName and tagline render as literal on-image text so
-- the model stops inventing a name; avoidNotes feeds a negative instruction.
ALTER TABLE "BrandKit" ADD COLUMN "brandName" TEXT;
ALTER TABLE "BrandKit" ADD COLUMN "tagline" TEXT;
ALTER TABLE "BrandKit" ADD COLUMN "avoidNotes" TEXT;
