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

// Anomaly scanning can take 30–60s on accounts with many campaigns + an
// LLM call per. Disable the default 10s timeout.
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await detectAnomaliesForAllAccounts();
    return NextResponse.json(result);
  } catch (err) {
    console.error("cron alerts/daily error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
