/**
 * POST /api/ai/audit/run
 *
 * Run an on-demand auto-audit for one account. Composes the four checks
 * (budget / naming / URL+UTM / voice drift), narrates an executive summary,
 * and returns the structured result. Nothing is persisted today — the audit
 * is cheap to re-run (~₹3–6 per click) and the strategist usually wants the
 * latest view.
 *
 * Body: { accountId }
 * Returns: AuditResult
 */

import { NextResponse } from "next/server";
import { auditAccount } from "@/server/services/ai/audit-account";

// 4 checks + 1 LLM summary call. Naming check is the longest because it
// goes through OpenAI. Lift the default 10s ceiling.
export const maxDuration = 120;

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
    const result = await auditAccount(body.accountId.trim());
    return NextResponse.json(result);
  } catch (err) {
    console.error("audit run error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
