import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { MetaApiError } from "@/lib/meta/client";
import { syncAdSetsForAccount } from "@/server/services/sync/sync-adsets";

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
    const result = await syncAdSetsForAccount(row.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("sync adsets error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
