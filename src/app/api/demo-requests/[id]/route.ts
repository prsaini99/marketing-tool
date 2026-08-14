/**
 * PATCH /api/demo-requests/[id]
 *
 * Triage one inbound lead: move its status, or attach a note.
 *
 * Behind the session middleware, unlike the public submit route. Note the
 * path: this deliberately does NOT sit under /api/public/, because reading
 * and editing leads is exactly the kind of thing that prefix must never
 * expose.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isDemoStatus } from "@/lib/demo-request";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { status?: unknown; notes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: { status?: string; notes?: string | null } = {};

  if (body.status !== undefined) {
    if (!isDemoStatus(body.status)) {
      return NextResponse.json({ error: "Unknown status" }, { status: 400 });
    }
    data.status = body.status;
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") {
      return NextResponse.json({ error: "notes must be text" }, { status: 400 });
    }
    // Bounded like everything else that reaches this table.
    data.notes = body.notes.trim().slice(0, 4000) || null;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const updated = await prisma.demoRequest.update({ where: { id }, data });
    return NextResponse.json({ ok: true, status: updated.status });
  } catch {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
}
