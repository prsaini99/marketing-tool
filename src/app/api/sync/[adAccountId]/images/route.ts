/**
 * POST /api/sync/[adAccountId]/images
 *
 * Per-account image library sync. The bulk route at /api/sync/images loops
 * this service across multiple accounts; this single-account variant exists
 * for parity with the other sync kinds and lets a future per-account
 * "refresh just this one" button hook in without duplicating logic.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { MetaApiError } from "@/lib/meta/client";
import { syncImagesForAccount } from "@/server/services/sync/sync-images";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ adAccountId: string }> },
) {
  const { adAccountId: urlId } = await params;
  const metaAdAccountId = `act_${urlId}`;

  const row = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId, selectedForSync: true },
    select: { id: true },
  });
  if (!row) {
    return NextResponse.json(
      { error: "Ad account not found or not selected for sync" },
      { status: 404 },
    );
  }

  try {
    const result = await syncImagesForAccount(row.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("sync images error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
