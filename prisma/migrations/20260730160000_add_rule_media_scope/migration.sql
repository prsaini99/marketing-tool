-- Rule-level post scope: ALL | ORGANIC | ADS | SPECIFIC.
-- Hand-written for the same reason as 20260730130000: `prisma migrate dev`
-- cannot replay this project's history in a shadow database (a pre-existing
-- migration fails with P1014), while the live schema is current.
-- Existing rows default to ALL, which preserves today's behaviour: a rule
-- with mediaId set behaved as "specific", so those are migrated to SPECIFIC.
ALTER TABLE "BotRule" ADD COLUMN "mediaScope" TEXT NOT NULL DEFAULT 'ALL';
UPDATE "BotRule" SET "mediaScope" = 'SPECIFIC' WHERE "mediaId" IS NOT NULL;
