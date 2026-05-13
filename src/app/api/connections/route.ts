/**
 * DELETE /api/connections
 *
 * Bulk delete every connection. Used by the "Disconnect all" button in
 * Settings → Danger zone. Cascade handles everything underneath.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function DELETE() {
  const result = await prisma.connection.deleteMany({});
  return NextResponse.json({
    success: true,
    deletedCount: result.count,
  });
}
