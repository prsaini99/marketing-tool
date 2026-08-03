/**
 * SPENT: the source column BotThread.recentMessagesJson was dropped on
 * 2026-08-01. This script no longer runs and is kept for reference only.
 *
 * One-off: moves BotThread.recentMessagesJson entries into BotMessage rows.
 *
 * Channel is not recoverable from the blob — it stored only {role, text, at},
 * and comment events were appended to it alongside DMs. So channel is resolved
 * best-effort:
 *   USER messages -> match AutomationEvent on (fromIgsid, text) for its eventType
 *   BOT  messages -> match AutomationLog on renderedText for its action
 * Anything unmatched is recorded as UNKNOWN rather than guessed.
 *
 * Idempotent: skips a thread that already has rows, so a re-run cannot double-insert.
 *
 * Run: npx dotenv -e .env -- node scripts/backfill-bot-messages.mjs
 */
// Hard stop BEFORE any DB access. Without it the script connects, queries, and
// dies on a Prisma error about an unknown column, which reads like a broken
// schema rather than "this script already did its job and cannot run again".
console.error(
  [
    "backfill-bot-messages.mjs is SPENT and cannot run.",
    "",
    "Its source column, BotThread.recentMessagesJson, was dropped on 2026-08-01",
    "(migration 20260801130000_drop_recent_messages_json). The backfill it",
    "performed is already applied; BotMessage rows are the live store now.",
    "",
    "The code below is kept only as a record of how the migration was done.",
  ].join("\n"),
);
process.exit(1);

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DM_ACTIONS = ["DM", "AI_DM", "DM_VIA_COMMENT", "AI_DM_VIA_COMMENT"];

const threads = await prisma.botThread.findMany();
let inserted = 0;
let skipped = 0;

for (const t of threads) {
  const existing = await prisma.botMessage.count({ where: { threadId: t.id } });
  if (existing > 0) {
    console.log(`thread ${t.id}: already has ${existing} rows, skipping`);
    skipped += 1;
    continue;
  }

  const blob = Array.isArray(t.recentMessagesJson) ? t.recentMessagesJson : [];
  for (const m of blob) {
    if (typeof m?.role !== "string" || typeof m?.text !== "string") continue;

    const role = m.role === "assistant" ? "BOT" : "USER";
    let channel = "UNKNOWN";

    if (role === "USER") {
      const ev = await prisma.automationEvent.findFirst({
        where: { fromIgsid: t.igsid, text: m.text },
        select: { eventType: true },
      });
      if (ev) channel = ev.eventType === "COMMENT" ? "COMMENT" : "DM";
    } else {
      const log = await prisma.automationLog.findFirst({
        where: { renderedText: m.text },
        select: { action: true },
      });
      if (log) channel = DM_ACTIONS.includes(log.action) ? "DM" : "COMMENT";
    }

    await prisma.botMessage.create({
      data: {
        threadId: t.id,
        role,
        text: m.text,
        channel,
        createdAt: m.at ? new Date(m.at) : new Date(),
      },
    });
    inserted += 1;
  }
  console.log(`thread ${t.id}: inserted ${blob.length} rows`);
}

console.log(`\nDONE. inserted=${inserted} threadsSkipped=${skipped}`);
await prisma.$disconnect();
