/**
 * GET /api/pixels?accountId=<act_... | ...>
 *
 * Returns the Meta Pixels on one ad account, used by the Create Custom
 * Conversion modal's pixel picker. Proxies Meta's /act_X/adspixels live —
 * we don't mirror pixels in the DB (small, rarely-changing list).
 *
 * Response: { pixels: [{ id, name }] }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

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
    select: {
      metaAdAccountId: true,
      business: { select: { connectionId: true } },
    },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Ad account not found or not selected for sync" },
      { status: 404 },
    );
  }

  try {
    const pixels = await metaClient.listAdPixels(
      account.business.connectionId,
      account.metaAdAccountId,
    );
    return NextResponse.json({ pixels });
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("list pixels error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
