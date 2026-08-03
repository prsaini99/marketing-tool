-- Best-effort display username for BotThread, populated from
-- AutomationEvent.fromUsername (comment webhooks only; DM webhooks never
-- carry one, see src/lib/meta/webhooks.ts).
ALTER TABLE "BotThread" ADD COLUMN "username" TEXT;
