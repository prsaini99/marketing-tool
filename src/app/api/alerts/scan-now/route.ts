/**
 * POST /api/alerts/scan-now
 *
 * Manual trigger for the same scan the daily cron runs. Lets the user
 * regenerate alerts immediately after a fresh insights sync without
 * waiting for the next overnight run.
 */

import { NextResponse } from "next/server";
import { detectAnomaliesForAllAccounts } from "@/server/services/ai/detect-anomalies";

export const maxDuration = 300;

export async function POST() {
  try {
    const result = await detectAnomaliesForAllAccounts();
    return NextResponse.json(result);
  } catch (err) {
    console.error("alerts scan-now error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
