/**
 * One-off: repairs BotMessage.createdAt for rows inserted by
 * scripts/backfill-bot-messages.mjs (now spent/removed as a source).
 *
 * The backfill read `at` off the old recentMessagesJson blob, but
 * readThreadMessages dropped `at` on every re-serialize, so most historical
 * USER rows had no `at` and were stamped with the backfill's own wall-clock
 * time. That put USER rows AFTER the BOT replies that answered them,
 * inverting conversation order for the AI history window.
 *
 * The true inbound times survive in AutomationEvent (never touched by the
 * backfill or the blob). This script re-derives each backfilled USER row's
 * createdAt by matching on (thread.igsid, text) against AutomationEvent.
 *
 * Matching is many-to-many-safe: a user can send the same text twice (e.g.
 * "Ai" x2 in one thread), so a naive "first matching event" would assign the
 * same timestamp to both rows. Instead:
 *   - BotMessage rows sharing the same text within a thread are ordered by
 *     `id` (creation order, stable and independent of the very createdAt
 *     values being repaired).
 *   - AutomationEvent rows matching that text are ordered by createdAt asc.
 *   - They are zipped 1:1: the row created first gets the earliest event,
 *     etc. Each event is used for at most one row.
 *
 * This makes the script idempotent: the id-based ordering never changes, so
 * re-running always recomputes and reapplies the same mapping — never a
 * different one. No role='BOT' row is touched.
 *
 * Run: npx dotenv -e .env -- node scripts/fix-backfilled-message-times.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function fmt(m) {
  return `  ${m.role}/${m.channel}  ${m.createdAt.toISOString()}  id=${m.id}  text=${JSON.stringify(m.text)}`;
}

const threads = await prisma.botThread.findMany({
  select: { id: true, igsid: true },
});

let updated = 0;
let unmatchedRows = 0;

for (const t of threads) {
  const before = await prisma.botMessage.findMany({
    where: { threadId: t.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (before.length === 0) continue;

  const userRows = before.filter((m) => m.role === "USER");
  if (userRows.length === 0) continue;

  // Group USER rows by text, ordered by id for stable, createdAt-independent
  // assignment order.
  const byText = new Map();
  for (const m of userRows) {
    if (!byText.has(m.text)) byText.set(m.text, []);
    byText.get(m.text).push(m);
  }
  for (const rows of byText.values()) {
    rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const updates = []; // { id, newCreatedAt }
  for (const [text, rows] of byText.entries()) {
    const events = await prisma.automationEvent.findMany({
      where: { fromIgsid: t.igsid, text },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    for (let i = 0; i < rows.length; i++) {
      const ev = events[i];
      if (!ev) {
        console.log(
          `  WARNING: no AutomationEvent[${i}] match for thread ${t.id} text=${JSON.stringify(text)} row id=${rows[i].id} — left unchanged`,
        );
        unmatchedRows += 1;
        continue;
      }
      updates.push({ id: rows[i].id, newCreatedAt: ev.createdAt });
    }
  }

  if (updates.length === 0) continue;

  console.log(`\n=== thread ${t.id} igsid=${t.igsid} — BEFORE ===`);
  for (const m of before) console.log(fmt(m));

  for (const u of updates) {
    await prisma.botMessage.update({
      where: { id: u.id },
      data: { createdAt: u.newCreatedAt },
    });
    updated += 1;
  }

  const after = await prisma.botMessage.findMany({
    where: { threadId: t.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  console.log(`--- thread ${t.id} — AFTER ---`);
  for (const m of after) console.log(fmt(m));
}

console.log(`\nDONE. rowsUpdated=${updated} unmatchedRows=${unmatchedRows}`);
await prisma.$disconnect();
