-- InstagramAccount becomes SocialAccount: one row per automated surface,
-- Instagram account or Facebook Page.
--
-- Hand-written because `prisma migrate dev` cannot replay this project's
-- migration history in a shadow database (a pre-existing migration fails
-- with P1014) while the live schema is current.
--
-- Existing rows are Instagram accounts and keep their behaviour: the
-- platform default backfills them to INSTAGRAM, and the old single-column
-- unique on igUserId becomes a per-platform compound unique.
ALTER TABLE "InstagramAccount" RENAME TO "SocialAccount";
ALTER TABLE "SocialAccount" RENAME COLUMN "igUserId" TO "accountId";
ALTER TABLE "SocialAccount" RENAME COLUMN "username" TO "displayName";
ALTER TABLE "SocialAccount" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'INSTAGRAM';

DROP INDEX IF EXISTS "InstagramAccount_igUserId_key";
CREATE UNIQUE INDEX "SocialAccount_platform_accountId_key"
  ON "SocialAccount"("platform", "accountId");
