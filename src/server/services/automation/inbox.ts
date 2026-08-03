/**
 * Operator actions on a conversation. The only module that sends a message
 * on a human's behalf.
 *
 * Deliberate deviation from the repo's audit-first rule: every other write
 * path writes a PENDING AutomationLog row before calling Meta, but
 * AutomationLog.eventDbId is a required FK to AutomationEvent and a human
 * send has no inbound webhook event to point at. Fabricating one would
 * pollute the idempotency table that protects against duplicate Meta
 * deliveries. The BotMessage row IS the record here, written after a
 * successful send, with failures surfaced straight to the operator — which
 * is safe precisely because a person is watching. Audit-first exists to
 * leave a trace when an UNATTENDED bot fails.
 */

import { prisma } from "@/lib/db/prisma";
import { sendDm } from "@/lib/meta/messaging";
import { appendMessages } from "./thread-messages";
import { THREAD_DM_WINDOW_HOURS } from "./decide";

export type ActionResult = { ok: true } | { ok: false; error: string };

const WINDOW_MS = THREAD_DM_WINDOW_HOURS * 60 * 60 * 1000;

/** True when Meta still allows a plain (untagged) reply on this thread. */
export function withinReplyWindow(
  lastInboundAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() <= WINDOW_MS;
}

/**
 * Run a botThread.update, turning "no such row" into the same
 * `{ ok: false, error: "Thread not found." }` sendHumanMessage already
 * returns. Prisma raises P2025 on an update whose WHERE matches nothing —
 * a stale threadId (deleted row, a link from another account) otherwise
 * escapes the route handler as a 500 for what is really a 404.
 */
async function updateThread(
  threadId: string,
  data: Parameters<typeof prisma.botThread.update>[0]["data"],
): Promise<ActionResult> {
  try {
    await prisma.botThread.update({ where: { id: threadId }, data });
  } catch (e) {
    if ((e as { code?: string }).code === "P2025") {
      return { ok: false, error: "Thread not found." };
    }
    throw e;
  }
  return { ok: true };
}

/** Claim a thread without sending anything yet. */
export async function takeOver(threadId: string): Promise<ActionResult> {
  return updateThread(threadId, { ownership: "HUMAN" });
}

/**
 * Hand the conversation back to the bot.
 *
 * Clears flagReason as well as ownership. Leaving a stale reason set would
 * permanently silence future flags on this thread: pickFlagReason returns
 * null whenever a reason is already present, so an ai_stuck on a thread that
 * was once "qualified" would be dropped forever.
 */
export async function returnToBot(threadId: string): Promise<ActionResult> {
  return updateThread(threadId, {
    ownership: "BOT",
    flagReason: null,
    flaggedAt: null,
    resolvedAt: null,
  });
}

/**
 * Mark the thread dealt with. Keeps ownership as-is but takes it out of the
 * queue — and clears flagReason for the same reason returnToBot does.
 */
export async function resolveThread(threadId: string): Promise<ActionResult> {
  return updateThread(threadId, {
    resolvedAt: new Date(),
    flagReason: null,
    flaggedAt: null,
  });
}

/**
 * Send a message as a human and hand the thread over.
 *
 * Ownership flips BEFORE the send: if the send succeeds but the process dies
 * before we record it, a thread stuck as HUMAN is merely quiet, whereas one
 * left as BOT would have the automation replying on top of a human's message.
 */
export async function sendHumanMessage(
  threadId: string,
  text: string,
): Promise<ActionResult> {
  const body = text.trim();
  if (!body) return { ok: false, error: "Message is empty." };

  const thread = await prisma.botThread.findUnique({
    where: { id: threadId },
    include: {
      igAccount: { select: { connectionId: true, linkedPageId: true } },
    },
  });
  if (!thread) return { ok: false, error: "Thread not found." };
  if (!thread.igAccount.linkedPageId) {
    return { ok: false, error: "This account has no linked Facebook Page." };
  }
  if (!withinReplyWindow(thread.lastInboundAt)) {
    return {
      ok: false,
      error:
        "Meta's 24-hour reply window has closed for this conversation. Replying later needs the HUMAN_AGENT tag, which requires App Review approval.",
    };
  }

  await prisma.botThread.update({
    where: { id: threadId },
    data: { ownership: "HUMAN" },
  });

  let messageId: string | null = null;
  try {
    const res = await sendDm(
      thread.igAccount.connectionId,
      thread.igAccount.linkedPageId,
      thread.igsid,
      body,
    );
    messageId = res.messageId;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // Store the returned mid: the echo of this very message comes back through
  // the webhook, and echo.ts uses metaMid to recognise it as ours and skip it.
  await appendMessages(threadId, [
    { role: "HUMAN", text: body, channel: "DM", metaMid: messageId },
  ]);
  return { ok: true };
}
