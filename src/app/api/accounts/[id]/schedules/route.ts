/**
 * GET /api/accounts/[id]/schedules
 *
 * Returns all 4 schedule rows (one per kind) for the modal to render.
 * Missing rows default to { frequency: "off" }. nextRunAt is nulled when
 * the schedule is disabled so the UI doesn't show "next" for an off cron.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { SCHEDULE_KINDS, type ScheduleKind } from "@/lib/schedule";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: urlId } = await params;

  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId: `act_${urlId}`, selectedForSync: true },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Ad account not found or not selected for sync" },
      { status: 404 },
    );
  }

  const rows = await prisma.syncSchedule.findMany({
    where: { adAccountId: account.id },
  });
  const byKind = new Map(rows.map((r) => [r.kind, r]));

  return NextResponse.json(
    SCHEDULE_KINDS.map((kind: ScheduleKind) => {
      const r = byKind.get(kind);
      return {
        kind,
        frequency: r?.frequency ?? "off",
        lastRunAt: r?.lastRunAt ? r.lastRunAt.toISOString() : null,
        nextRunAt:
          r?.enabled && r.nextRunAt ? r.nextRunAt.toISOString() : null,
      };
    }),
  );
}
