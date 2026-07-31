-- Per-rule AI steer, appended to the profile-level system prompt.
-- Written by hand rather than via `prisma migrate dev` because the shadow
-- database replay fails on a pre-existing historical migration
-- (20260516183000_add_ad_creative_link, P1014) unrelated to this change.
-- The live schema is up to date; this adds one nullable-with-default column.
ALTER TABLE "BotRule" ADD COLUMN "aiInstructions" TEXT NOT NULL DEFAULT '';
