/**
 * POST /api/automation/threads/[threadId] — operator actions on a single
 * conversation: take over, return to bot, resolve, or send a human reply.
 * Session-protected by src/middleware.ts (matches every /api route except
 * /api/auth/* and /api/cron/*), so no extra auth check is needed here.
 */

import { NextResponse } from "next/server";
import {
  resolveThread,
  returnToBot,
  sendHumanMessage,
  takeOver,
} from "@/server/services/automation/inbox";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const body = (await req.json()) as { action?: string; text?: string };

  switch (body.action) {
    case "take_over":
      return NextResponse.json(await takeOver(threadId));
    case "return_to_bot":
      return NextResponse.json(await returnToBot(threadId));
    case "resolve":
      return NextResponse.json(await resolveThread(threadId));
    case "send":
      return NextResponse.json(await sendHumanMessage(threadId, body.text ?? ""));
    default:
      return NextResponse.json(
        { ok: false, error: "Unknown action" },
        { status: 400 },
      );
  }
}
