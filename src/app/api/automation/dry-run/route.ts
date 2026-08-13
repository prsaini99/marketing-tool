/**
 * POST /api/automation/dry-run — run the automation engine against a
 * synthetic event with all side effects stubbed: no AutomationEvent/Log
 * writes, no thread writes, no Meta calls. Used by the rule editor's test
 * panel and as the engine's end-to-end verification harness.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  orchestrateEvent,
  type Sender,
} from "@/server/services/automation/orchestrate";
import type {
  IncomingEvent,
  RuleLike,
} from "@/server/services/automation/types";

interface Body {
  igAccountId?: unknown;
  eventType?: unknown;
  text?: unknown;
  mediaId?: unknown;
  fromIgsid?: unknown;
  callAi?: unknown;
  ruleOverride?: unknown;
}

interface RecordedSend {
  kind: string;
  to: string;
  text: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.igAccountId !== "string" || !body.igAccountId) {
    return NextResponse.json({ error: "igAccountId is required" }, { status: 400 });
  }
  if (body.eventType !== "COMMENT" && body.eventType !== "MESSAGE") {
    return NextResponse.json(
      { error: "eventType must be COMMENT or MESSAGE" },
      { status: 400 },
    );
  }
  if (typeof body.text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const account = await prisma.socialAccount.findUnique({
    where: { id: body.igAccountId },
    select: { accountId: true, platform: true, botEnabled: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Account not found" },
      { status: 404 },
    );
  }

  const event: IncomingEvent = {
    eventId: `dryrun-${Date.now()}`,
    platform: account.platform === "FACEBOOK" ? "FACEBOOK" : "INSTAGRAM",
    type: body.eventType,
    igUserId: account.accountId,
    fromIgsid: typeof body.fromIgsid === "string" ? body.fromIgsid : "dryrun-user",
    fromUsername: "dryrun_user",
    text: body.text,
    commentId: body.eventType === "COMMENT" ? "dryrun-comment" : null,
    mediaId: typeof body.mediaId === "string" ? body.mediaId : null,
    occurredAt: new Date(),
    raw: {},
  };

  const sent: RecordedSend[] = [];
  // Recording sender for the dry-run panel — records what WOULD be sent but
  // never calls Meta. Returns null for the (now) metaMid-returning Sender
  // interface: persist is always false here, so orchestrateEvent never
  // writes a BotMessage row for these outcomes anyway (that write is gated
  // on `persist`), and there is no real Meta message id to report.
  const sender: Sender = {
    sendPublicReply: async (commentId, text) => {
      sent.push({ kind: "PUBLIC_REPLY", to: commentId, text });
      return null;
    },
    sendCommentDm: async (commentId, text) => {
      sent.push({ kind: "DM_VIA_COMMENT", to: commentId, text });
      return null;
    },
    sendThreadDm: async (igsid, text) => {
      sent.push({ kind: "DM", to: igsid, text });
      return null;
    },
  };

  let rulesOverride: RuleLike[] | undefined;
  if (body.ruleOverride && typeof body.ruleOverride === "object") {
    const r = body.ruleOverride as Partial<RuleLike>;
    rulesOverride = [
      {
        id: "dry-run",
        enabled: true,
        priority: 0,
        triggerType: r.triggerType ?? "COMMENT_KEYWORD",
        keywords: Array.isArray(r.keywords) ? r.keywords : [],
        negativeKeywords: Array.isArray(r.negativeKeywords)
          ? r.negativeKeywords
          : [],
        skipNoIntent: r.skipNoIntent === true,
        aiIntentGuard: r.aiIntentGuard === true,
        mediaScope:
          typeof r.mediaScope === "string" ? r.mediaScope : "ALL",
        mediaId: typeof r.mediaId === "string" ? r.mediaId : null,
        publicReplyEnabled: r.publicReplyEnabled === true,
        publicReplyTemplate:
          typeof r.publicReplyTemplate === "string" ? r.publicReplyTemplate : "",
        dmEnabled: r.dmEnabled === true,
        dmTemplate: typeof r.dmTemplate === "string" ? r.dmTemplate : "",
        aiFallback: r.aiFallback === true,
        aiInstructions:
          typeof r.aiInstructions === "string" ? r.aiInstructions : "",
        oncePerUser: r.oncePerUser !== false,
      },
    ];
  }

  const result = await orchestrateEvent(event, {
    sender,
    persist: false,
    callAi: body.callAi === true,
    rulesOverride,
  });

  return NextResponse.json({
    ok: true,
    outcomes: result.outcomes,
    sent,
    // A dry run deliberately evaluates rules even with the bot off, so tell
    // the caller when what it just previewed would NOT happen on live
    // traffic yet. Without this the panel would imply the bot is armed.
    botEnabled: account.botEnabled,
    note: account.botEnabled
      ? "persist=false, so nothing was sent or written."
      : "persist=false, so nothing was sent or written. The bot is currently OFF, and live comments and DMs are not being answered yet.",
  });
}
