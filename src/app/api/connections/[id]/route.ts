/**
 * DELETE /api/connections/[id]
 *
 * Removes a connection and everything it owns. The schema's `onDelete: Cascade`
 * chain handles the rest: MetaBusiness → MetaAdAccount → Campaign / AdSet /
 * Ad / InsightsSnapshot / SyncLog all go with it.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const existing = await prisma.connection.findUnique({
    where: { id },
    select: { id: true, label: true, tokenOwnerName: true },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 },
    );
  }

  await prisma.connection.delete({ where: { id } });

  return NextResponse.json({
    success: true,
    disconnected: existing.label || existing.tokenOwnerName || existing.id,
  });
}
