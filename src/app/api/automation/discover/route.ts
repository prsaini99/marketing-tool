/**
 * POST /api/automation/discover
 * Body: { connectionId: string }
 * Runs IG account discovery for one connection. Manual trigger (like the
 * audiences sync) — discovery is cheap and user-initiated.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { discoverIgAccountsForConnection } from "@/server/services/automation/discover-accounts";

interface Body {
  connectionId?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.connectionId !== "string" || !body.connectionId.trim()) {
    return NextResponse.json(
      { error: "connectionId is required" },
      { status: 400 },
    );
  }
  const connection = await prisma.connection.findUnique({
    where: { id: body.connectionId },
    select: { id: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const result = await discoverIgAccountsForConnection(body.connectionId);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
