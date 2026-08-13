/**
 * GET /api/cron/alerts/daily
 *
 * Triggered by Vercel Cron once a day (see vercel.json). Walks every
 * selected-for-sync account, diffs yesterday vs the 7-day baseline, and
 * persists an Alert row per anomaly with an LLM-narrated diagnosis. The
 * Alerts page reads from those rows — same code path as the manual
 * "Run scan" button.
 *
 * Auth: optional. If CRON_SECRET is set in env, we require the standard
 * `Authorization: Bearer <secret>` header (which Vercel Cron sends
 * automatically when the env var is present). When the secret isn't set,
 * we still let any caller through — fine for dev; tighten when you ship.
 */

import { NextResponse } from "next/server";
import { detectAnomaliesForAllAccounts } from "@/server/services/ai/detect-anomalies";
import { sendAllAlertDigests } from "@/server/services/notifications/alert-digest";
import { requireCronAuth } from "@/lib/cron-auth";

// Anomaly scanning can take 30–60s on accounts with many campaigns + an
// LLM call per. Disable the default 10s timeout.
export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const result = await detectAnomaliesForAllAccounts();

    // Deliver AFTER the scan, and never let delivery fail the scan. The scan
    // is the expensive, LLM-backed half; its Alert rows are already durable
    // by this point, so an email vendor outage must degrade to "no email
    // today", not to a 500 that makes the whole cron look failed. Accounts
    // without a NotificationSetting row are simply not in the loop.
    let delivery: Awaited<ReturnType<typeof sendAllAlertDigests>> | null = null;
    let deliveryError: string | null = null;
    try {
      delivery = await sendAllAlertDigests({
        dashboardUrl: process.env.APP_URL
          ? `${process.env.APP_URL}/dashboard/alerts`
          : undefined,
      });
    } catch (e) {
      deliveryError = e instanceof Error ? e.message : "Unknown delivery error";
      console.error("cron alerts/daily delivery error:", e);
    }

    return NextResponse.json({ ...result, delivery, deliveryError });
  } catch (err) {
    console.error("cron alerts/daily error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
