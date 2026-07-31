-- Per-rule reply suppression: negative keywords, no-intent filter, AI guard.
--
-- Hand-written because `prisma migrate dev` cannot replay this project's
-- history in a shadow database (pre-existing P1014) while the live schema is
-- current.
--
-- skipNoIntent defaults TRUE, but every existing rule is COMMENT_KEYWORD
-- where the UI treats the filter as off-by-default; the explicit UPDATE below
-- makes existing rows keep today's exact behaviour rather than silently
-- gaining a filter their author never chose.
ALTER TABLE "BotRule" ADD COLUMN "negativeKeywords" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "BotRule" ADD COLUMN "skipNoIntent" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BotRule" ADD COLUMN "aiIntentGuard" BOOLEAN NOT NULL DEFAULT false;

UPDATE "BotRule" SET "skipNoIntent" = false WHERE "triggerType" LIKE '%KEYWORD';
