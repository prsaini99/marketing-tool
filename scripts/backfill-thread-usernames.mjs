/**
 * One-off: populates BotThread.username for threads that predate the
 * `username` column (added in migration 20260803120000_thread_username).
 *
 * For each BotThread with a null username, finds the most recent
 * AutomationEvent with a matching fromIgsid AND a non-null fromUsername
 * (comment webhooks carry a username; DM webhooks never do — see
 * src/lib/meta/webhooks.ts) and writes it onto the thread.
 *
 * Idempotent: skips a thread that already has a username, so a re-run is a
 * no-op. Threads with no matching AutomationEvent (DM-only conversations)
 * are left null on purpose — there is nothing to backfill from.
 *
 * Run: npx dotenv -e .env -- node scripts/backfill-thread-usernames.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const threads = await prisma.botThread.findMany();
let updated = 0;
let skipped = 0;
let notFound = 0;

for (const t of threads) {
  if (t.username) {
    console.log(`thread ${t.id} (igsid ${t.igsid}): already has username "${t.username}", skipping`);
    skipped += 1;
    continue;
  }

  const event = await prisma.automationEvent.findFirst({
    where: { igAccountId: t.igAccountId, fromIgsid: t.igsid, fromUsername: { not: null } },
    orderBy: { createdAt: "desc" },
  });

  if (!event?.fromUsername) {
    console.log(`thread ${t.id} (igsid ${t.igsid}): no AutomationEvent with a username found, leaving null`);
    notFound += 1;
    continue;
  }

  console.log(`thread ${t.id} (igsid ${t.igsid}): before username=${t.username ?? "null"} -> after username=${event.fromUsername}`);
  await prisma.botThread.update({
    where: { id: t.id },
    data: { username: event.fromUsername },
  });
  updated += 1;
}

console.log(`\nDone. updated=${updated} skipped=${skipped} notFound=${notFound}`);
await prisma.$disconnect();
