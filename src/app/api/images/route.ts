/**
 * GET /api/images?accountId=<act_... | ...>
 *
 * Returns the synced AdImages for one account, used by the Create Creative
 * image picker. Reads from our local mirror (populated by the images sync) —
 * fast, no Meta round-trip. The `hash` is what a creative references.
 *
 * Response: { images: [{ hash, url, name, width, height }] }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const accountIdParam = url.searchParams.get("accountId");
  if (!accountIdParam) {
    return NextResponse.json(
      { error: "accountId query param is required" },
      { status: 400 },
    );
  }
  const metaAdAccountId = accountIdParam.startsWith("act_")
    ? accountIdParam
    : `act_${accountIdParam}`;

  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId, selectedForSync: true },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Ad account not found or not selected for sync" },
      { status: 404 },
    );
  }

  const images = await prisma.adImage.findMany({
    where: { adAccountId: account.id },
    select: {
      metaImageHash: true,
      url: true,
      name: true,
      width: true,
      height: true,
    },
    orderBy: { syncedAt: "desc" },
    take: 500,
  });

  return NextResponse.json({
    images: images.map((i) => ({
      hash: i.metaImageHash,
      url: i.url,
      name: i.name,
      width: i.width,
      height: i.height,
    })),
  });
}
