/**
 * POST /api/ai/reports/weekly
 *
 * Generate the auto-drafted weekly performance report for one ad account.
 *
 * Body: { accountId }
 * Returns: { markdown, context }
 */

import { NextResponse } from "next/server";
import { generateWeeklyReport } from "@/server/services/ai/generate-weekly-report";

export async function POST(req: Request) {
  let body: { accountId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.accountId !== "string" || !body.accountId.trim()) {
    return NextResponse.json(
      { error: "accountId is required" },
      { status: 400 },
    );
  }

  try {
    const result = await generateWeeklyReport(body.accountId.trim());
    return NextResponse.json(result);
  } catch (err) {
    console.error("weekly report error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
