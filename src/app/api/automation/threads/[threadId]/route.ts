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

  // An empty or malformed body makes req.json() throw, which Next surfaces as
  // a 500 — a client mistake reported as a server fault. Catch it and answer
  // with the same { ok: false, error } / 400 shape the unknown-action branch
  // below already uses.
  let body: { action?: string; text?: string };
  try {
    body = (await req.json()) as { action?: string; text?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  switch (body.action) {
    case "take_over":
      return NextResponse.json(await takeOver(threadId));
    case "return_to_bot":
      return NextResponse.json(await returnToBot(threadId));
    case "resolve":
      return NextResponse.json(await resolveThread(threadId));
    case "send":
      // `text` is attacker-shaped JSON, not necessarily a string — a number or
      // object would reach .trim() downstream and throw a 500.
      if (body.text !== undefined && typeof body.text !== "string") {
        return NextResponse.json(
          { ok: false, error: "text must be a string" },
          { status: 400 },
        );
      }
      return NextResponse.json(await sendHumanMessage(threadId, body.text ?? ""));
    default:
      return NextResponse.json(
        { ok: false, error: "Unknown action" },
        { status: 400 },
      );
  }
}
