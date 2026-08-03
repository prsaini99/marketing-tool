/**
 * The only module that reads or writes BotMessage rows.
 *
 * Exists so orchestrate.ts does not grow a seventh responsibility: it
 * previously hand-rolled JSON array slicing inline, which is how the history
 * silently capped at 10 messages without anywhere obvious to notice.
 */

import { prisma } from "@/lib/db/prisma";

export type MessageRole = "USER" | "BOT" | "HUMAN";
export type MessageChannel = "DM" | "COMMENT";

/**
 * How many past messages the AI sees. Was 10 — which lost the opening of any
 * conversation longer than a few turns, so the bot re-asked for a budget the
 * user had already given. Raised to 30: DM threads are short, and 30 turns of
 * IG-length messages is a small fraction of the model's context.
 */
export const AI_HISTORY_LIMIT = 30;

/**
 * The most recent `limit` messages, oldest first.
 *
 * Ordered DESC in the query then reversed, because "the last 30" and "the
 * first 30" are different sets — taking ASC would hand the model the start of
 * a long conversation and drop what was just said.
 *
 * `id` is a tiebreaker on top of `createdAt`: a single `appendMessages`
 * `createMany` call stamps every row with Postgres's transaction timestamp,
 * so a BOT comment+DM pair (or any multi-row insert) can share the exact
 * same `createdAt` millisecond. Without a secondary key, ordering between
 * those rows — and which ones land on the 30-row boundary — is arbitrary.
 * cuid()s are lexically ordered by creation time, so `id desc` breaks ties
 * in the same direction as `createdAt desc`.
 */
export async function readRecentMessages(
  threadId: string,
  limit: number = AI_HISTORY_LIMIT,
): Promise<Array<{ role: string; text: string }>> {
  const rows = await prisma.botMessage.findMany({
    where: { threadId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: { role: true, text: true },
  });
  return rows.reverse();
}

/**
 * Append messages to a thread.
 *
 * `metaMid` is unique, so a redelivered webhook would throw on insert. That is
 * skipped rather than raised: a duplicate delivery is a no-op, not an error,
 * and must never break processing of the rest of the event.
 */
export async function appendMessages(
  threadId: string,
  msgs: Array<{
    role: MessageRole;
    text: string;
    channel: MessageChannel;
    metaMid?: string | null;
  }>,
): Promise<void> {
  if (msgs.length === 0) return;
  await prisma.botMessage.createMany({
    data: msgs.map((m) => ({
      threadId,
      role: m.role,
      text: m.text,
      channel: m.channel,
      metaMid: m.metaMid ?? null,
    })),
    skipDuplicates: true,
  });
}
