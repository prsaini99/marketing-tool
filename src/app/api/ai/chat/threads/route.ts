/**
 * GET /api/ai/chat/threads — list chat threads, newest-first.
 *
 * Returns just the metadata the sidebar needs: id, title, updatedAt.
 * Messages live behind /api/ai/chat/threads/[id].
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const threads = await prisma.chatThread.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      createdAt: true,
    },
    take: 200,
  });
  return NextResponse.json({ threads });
}
