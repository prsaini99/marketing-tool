/**
 * GET /api/pages?accountId=<act_... | ...>
 *
 * Facebook Pages an ad account can promote — feeds the Create Creative
 * page picker (object_story_spec.page_id). Proxies /act_X/promote_pages
 * live; no DB mirror.
 *
 * Response: { pages: [{ id, name }] }
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
    const pages = await metaClient.listPromotablePages(
      account.business.connectionId,
      account.metaAdAccountId,
    );
    return NextResponse.json({ pages });
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("list pages error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
