/**
 * GET /api/alerts
 *   List alerts. Default: not-yet-dismissed, newest first. Use ?all=1 to
 *   include dismissed (for an "archive" view), ?count=1 for just the
 *   unread badge count.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeAll = url.searchParams.get("all") === "1";
  const countOnly = url.searchParams.get("count") === "1";

  const where = includeAll ? {} : { dismissedAt: null };

  if (countOnly) {
    const count = await prisma.alert.count({ where });
    return NextResponse.json({ count });
  }

  const alerts = await prisma.alert.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      adAccount: {
        select: {
          metaAdAccountId: true,
          name: true,
          currency: true,
          business: { select: { id: true, name: true } },
        },
      },
    },
    take: 200,
  });
  return NextResponse.json({ alerts });
}
