/**
 * GET /api/ai/ad-video?client=<businessId>
 *
 * Two lists, for two different jobs.
 *
 * `generations` is the history strip: the twelve most recent for the scope,
 * read raw. `pending` is every non-terminal row for the scope regardless of
 * age — the client has to advance those or they never move, and a job stuck
 * QUEUED that twelve later generations pushed off the strip is exactly the
 * one nobody would otherwise poll. It is a deliberately narrow query on
 * VideoGeneration's status index rather than a bigger `take` on the first.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toPublic } from "@/server/services/video/generation";

/** OUR vocabulary; see the status column's note in schema.prisma. */
const NON_TERMINAL = ["QUEUED", "RUNNING"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const client = url.searchParams.get("client")?.trim();
  // An absent or empty client is the workspace scope, exactly as
  // /api/brand-kit folds it.
  const businessId = client ? client : null;

  const [rows, pending] = await Promise.all([
    prisma.videoGeneration.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.videoGeneration.findMany({
      where: { businessId, status: { in: NON_TERMINAL } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({
    generations: rows.map(toPublic),
    pending: pending.map(toPublic),
  });
}
