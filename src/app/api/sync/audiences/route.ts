/**
 * POST /api/sync/audiences?client=<businessDbId>
 *
 * Page-scoped bulk custom-audiences sync. Sequential — same Meta-rate-safe
 * shape as the other bulk routes.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { MetaApiError } from "@/lib/meta/client";
import { syncAudiencesForAccount } from "@/server/services/sync/sync-audiences";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("client");

  const accounts = await prisma.metaAdAccount.findMany({
    where: {
      selectedForSync: true,
      ...(businessId ? { businessId } : {}),
    },
    select: { id: true, name: true, metaAdAccountId: true },
  });

  if (accounts.length === 0) {
    return NextResponse.json(
      { error: "No ad accounts selected for sync under this scope" },
      { status: 404 },
    );
  }

  const results: Array<{
    metaAdAccountId: string;
    name: string;
    status: "success" | "failed";
    upserted?: number;
    error?: string;
  }> = [];

  for (const acct of accounts) {
    try {
      const r = await syncAudiencesForAccount(acct.id);
      results.push({
        metaAdAccountId: acct.metaAdAccountId,
        name: acct.name,
        status: "success",
        upserted: r.upserted,
      });
    } catch (err) {
      const message =
        err instanceof MetaApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unknown error";
      results.push({
        metaAdAccountId: acct.metaAdAccountId,
        name: acct.name,
        status: "failed",
        error: message,
      });
    }
  }

  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return NextResponse.json({
    accounts: accounts.length,
    succeeded,
    failed,
    results,
  });
}
