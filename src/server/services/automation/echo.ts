/**
 * Echo reconciliation — the only module that interprets Meta's outbound
 * echoes.
 *
 * Meta emits a webhook echo for EVERY outbound message, including ones sent
 * from Meta Business Suite or the Instagram app on someone's phone. These
 * used to be dropped wholesale at the webhook route. That was safe but threw
 * away the one signal that tells us a human replied outside this dashboard —
 * which is how a small team actually works. Recording them means handoff
 * works even if nobody ever opens our inbox.
 *
 * An echo whose `metaMid` matches a row we already wrote is OUR OWN send
 * (bot or inbox) being reflected back: record nothing new, and above all do
 * NOT flip ownership, or the bot would stand itself down after every reply.
 * (This depends on BOT sends carrying their real Meta message id as
 * `metaMid` — see orchestrate.ts's Sender interface / makeMetaSender.)
 */

import { prisma } from "@/lib/db/prisma";
import { appendMessages } from "./thread-messages";

export type EchoOutcome = "ignored" | "recorded_ours" | "recorded_human";

export interface EchoInput {
  /** Meta message id of the echoed message. */
  metaMid: string;
  /** The customer's platform-scoped id — the RECIPIENT of an outbound echo. */
  toIgsid: string | null;
  text: string;
}

export async function recordEcho(
  input: EchoInput,
  igAccountId: string,
): Promise<EchoOutcome> {
  // No recipient means we cannot attribute this to a conversation. Comment
  // echoes land here too and legitimately have none.
  if (!input.toIgsid || !input.metaMid) return "ignored";

  // Already recorded? Then this is our own send (we store the mid returned by
  // the Send API) or a duplicate delivery. Either way: nothing to do.
  const known = await prisma.botMessage.findUnique({
    where: { metaMid: input.metaMid },
    select: { id: true },
  });
  if (known) return "recorded_ours";

  const thread = await prisma.botThread.findUnique({
    where: {
      igAccountId_igsid: { igAccountId, igsid: input.toIgsid },
    },
    select: { id: true, ownership: true },
  });
  // No thread means this person has never messaged us through the bot, so
  // there is no conversation to hand over. Do not create one from an echo.
  if (!thread) return "ignored";

  // The ownership flip is the safety property; the BotMessage row is just
  // bookkeeping. Flip FIRST and unconditionally once we know this is a
  // genuine, unrecognised echo on a real thread — do NOT gate it on
  // `input.text` being non-empty. A human replying with an image, sticker,
  // or GIF from the Instagram app arrives here with `text: ""`, but it is
  // still a real human reply and must still hand the thread over; gating
  // the flip on text left the bot free to keep answering over a live human
  // conversation whenever the human's first reply wasn't plain text. Do not
  // reorder this back — that was a reported Critical/Important finding.
  if (thread.ownership !== "HUMAN") {
    await prisma.botThread.update({
      where: { id: thread.id },
      data: { ownership: "HUMAN" },
    });
  }

  // Nothing worth recording as a message row (image/sticker echo, or a
  // genuinely blank text field) — the handover already happened above.
  if (!input.text.trim()) return "recorded_human";

  await appendMessages(thread.id, [
    { role: "HUMAN", text: input.text, channel: "DM", metaMid: input.metaMid },
  ]);

  return "recorded_human";
}
