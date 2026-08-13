/**
 * GET|POST /api/cron/tick
 *
 * Scheduler driver. Called periodically to find due schedules and fire them:
 * in dev by scripts/cron-worker.mjs (POST), in prod by Vercel Cron (GET, see
 * vercel.json).
 *
 * BOTH VERBS EXIST DELIBERATELY. Vercel Cron issues GET and nothing else;
 * this route was POST-only, so listing it in vercel.json without a GET
 * handler produces a 405 on every run — a scheduler that appears configured,
 * reports no errors anywhere a human looks, and silently never syncs. The
 * dev worker keeps using POST, so both are supported rather than swapped.
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
import { requireCronAuth } from "@/lib/cron-auth";

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

/**
 * Vercel Cron's entrypoint. The middleware exempts /api/cron/*, so
 * requireCronAuth is the only thing standing in front of a full sync run.
 */
export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  return runTick();
}

/**
 * The dev worker (scripts/cron-worker.mjs) POSTs here.
 *
 * This handler MUST repeat the guard rather than delegating to GET. It used
 * to be the whole implementation, exported with no request parameter and no
 * check at all, which left an unauthenticated way to trigger every scheduled
 * sync even once GET was locked down. Both verbs now authenticate, and the
 * work itself lives in runTick() where no route export can reach it directly.
 */
export async function POST(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  return runTick();
}

async function runTick() {
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
