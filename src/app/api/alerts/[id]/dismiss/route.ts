/**
 * POST /api/alerts/[id]/dismiss
 *   Dismiss an alert (idempotent — re-dismissing is a no-op). Body can
 *   optionally include { undo: true } to clear the dismissal.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { undo?: unknown } = {};
  try {
    body = (await req.json()) as { undo?: unknown };
  } catch {
    // empty body is fine
  }
  const undo = body.undo === true;

  try {
    await prisma.alert.update({
      where: { id },
      data: { dismissedAt: undo ? null : new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2025"
    ) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }
    console.error("dismiss alert error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
