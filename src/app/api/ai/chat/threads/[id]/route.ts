/**
 * GET /api/ai/chat/threads/[id]
 *   Read a thread's metadata + the compacted "turns" view used by the UI.
 *
 * DELETE /api/ai/chat/threads/[id]
 *   Drop a thread (cascades to its messages via the FK).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadThreadTurns } from "@/server/services/ai/chat-with-data";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const thread = await prisma.chatThread.findUnique({
    where: { id },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  const turns = await loadThreadTurns(id);
  return NextResponse.json({ thread, turns: turns ?? [] });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await prisma.chatThread.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // P2025 = record not found; treat as already-gone for idempotency.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2025"
    ) {
      return NextResponse.json({ ok: true });
    }
    console.error("delete thread error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
