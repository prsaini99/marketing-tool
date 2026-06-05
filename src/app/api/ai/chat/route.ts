/**
 * POST /api/ai/chat
 *
 * One conversation turn — server holds the truth. The client sends just
 * the new user message + (optionally) the thread it belongs to:
 *
 *   • threadId omitted/null  → creates a new thread (auto-titled from
 *     content), then runs the turn against it.
 *   • threadId provided      → appends to the existing thread.
 *
 * Returns: { threadId, threadTitle, reply, toolsUsed }
 *
 * The full message stream lives in the DB; the client never has to
 * reconstruct the OpenAI wire format.
 */

import { NextResponse } from "next/server";
import {
  createThreadFromFirstMessage,
  runChatTurn,
} from "@/server/services/ai/chat-with-data";
import { prisma } from "@/lib/db/prisma";

export async function POST(req: Request) {
  let body: { threadId?: unknown; content?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json(
      { error: "content is required" },
      { status: 400 },
    );
  }
  const content = body.content.trim();

  try {
    let threadId: string;
    let threadTitle: string;

    if (typeof body.threadId === "string" && body.threadId.trim()) {
      threadId = body.threadId.trim();
      const existing = await prisma.chatThread.findUnique({
        where: { id: threadId },
        select: { id: true, title: true },
      });
      if (!existing) {
        return NextResponse.json(
          { error: "Thread not found" },
          { status: 404 },
        );
      }
      threadTitle = existing.title;
    } else {
      const created = await createThreadFromFirstMessage(content);
      threadId = created.id;
      threadTitle = created.title;
    }

    const { reply, toolsUsed } = await runChatTurn(threadId, content);
    return NextResponse.json({
      threadId,
      threadTitle,
      reply,
      toolsUsed,
    });
  } catch (err) {
    console.error("ai chat error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
