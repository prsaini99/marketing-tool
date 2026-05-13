/**
 * POST /api/cron/tick
 *
 * Scheduler driver. Called periodically (dev: by scripts/cron-worker.mjs,
 * prod TBD: Vercel cron / system cron) to find due schedules and fire them.
 *
 * Per run:
 *  1. Pick `SyncSchedule` rows where `enabled=true` AND `nextRunAt <= now`.
 *  2. For each, check for an in-flight SyncLog (same kind, status=running,
 *     started < 30 min ago) — skip if found. Prevents pile-up if a previous
 *     run got stuck.
 *  3. Fire the matching sync service.
 *  4. Update `lastRunAt` + recompute `nextRunAt`.
 *
 * The endpoint is idempotent — running it twice in the same minute does
 * nothing extra because `nextRunAt` moves forward after a successful fire.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  computeNextRun,
  type FrequencyKey,
  type ScheduleKind,
} from "@/lib/schedule";
import { syncCampaignsForAccount } from "@/server/services/sync/sync-campaigns";
import { syncAdSetsForAccount } from "@/server/services/sync/sync-adsets";
import { syncAdsForAccount } from "@/server/services/sync/sync-ads";
import { syncInsightsForAccount } from "@/server/services/sync/sync-insights";

const RUN_LOCK_WINDOW_MS = 30 * 60 * 1000; // 30 min

interface TickReport {
  ran: number;
  skipped: number;
  errors: number;
  details: Array<{
    adAccountId: string;
    kind: ScheduleKind;
    status: "ran" | "skipped" | "errored";
    reason?: string;
  }>;
}

async function runByKind(adAccountId: string, kind: ScheduleKind) {
  switch (kind) {
    case "campaigns":
      return syncCampaignsForAccount(adAccountId);
    case "adsets":
      return syncAdSetsForAccount(adAccountId);
    case "ads":
      return syncAdsForAccount(adAccountId);
    case "insights":
      return syncInsightsForAccount(adAccountId);
  }
}

export async function POST() {
  const now = new Date();
  const lockCutoff = new Date(now.getTime() - RUN_LOCK_WINDOW_MS);

  const due = await prisma.syncSchedule.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: now },
    },
    include: { adAccount: { select: { id: true, selectedForSync: true } } },
  });

  const report: TickReport = {
    ran: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  for (const sched of due) {
    const kind = sched.kind as ScheduleKind;

    // Defensive: skip if the underlying account was deselected.
    if (!sched.adAccount.selectedForSync) {
      report.skipped++;
      report.details.push({
        adAccountId: sched.adAccountId,
        kind,
        status: "skipped",
        reason: "account not selected for sync",
      });
      continue;
    }

    // Skip if a previous run of the same kind is still in flight.
    const inflight = await prisma.syncLog.findFirst({
      where: {
        adAccountId: sched.adAccountId,
        kind,
        status: "running",
        startedAt: { gt: lockCutoff },
      },
      select: { id: true },
    });
    if (inflight) {
      report.skipped++;
      report.details.push({
        adAccountId: sched.adAccountId,
        kind,
        status: "skipped",
        reason: "previous run still in flight",
      });
      continue;
    }

    try {
      await runByKind(sched.adAccountId, kind);
      report.ran++;
      report.details.push({
        adAccountId: sched.adAccountId,
        kind,
        status: "ran",
      });
    } catch (err) {
      report.errors++;
      report.details.push({
        adAccountId: sched.adAccountId,
        kind,
        status: "errored",
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      // Always move nextRunAt forward — even on error — so a failing sync
      // doesn't block the queue. The SyncLog row records the failure.
      await prisma.syncSchedule.update({
        where: { id: sched.id },
        data: {
          lastRunAt: new Date(),
          nextRunAt: computeNextRun(sched.frequency as FrequencyKey),
        },
      });
    }
  }

  return NextResponse.json(report);
}
