/**
 * POST /api/campaigns/bulk-status
 *
 * Body: { action: "pause" | "activate" | "archive", metaCampaignIds: string[] }
 *
 * Bulk-changes campaign status on Meta. Every per-campaign call is mirrored
 * to the local DB and recorded in AuditLog. See bulk-status.ts for the
 * per-campaign flow.
 */

import { NextResponse } from "next/server";
import {
  bulkChangeCampaignStatus,
  type CampaignBulkAction,
} from "@/server/services/campaigns/bulk-status";

const VALID_ACTIONS: CampaignBulkAction[] = ["pause", "activate", "archive"];

interface Body {
  action?: unknown;
  metaCampaignIds?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action as CampaignBulkAction;
  if (typeof action !== "string" || !VALID_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const ids = Array.isArray(body.metaCampaignIds)
    ? body.metaCampaignIds.filter((x): x is string => typeof x === "string")
    : null;
  if (!ids || ids.length === 0) {
    return NextResponse.json(
      { error: "metaCampaignIds must be a non-empty array of strings" },
      { status: 400 },
    );
  }

  try {
    const result = await bulkChangeCampaignStatus({
      action,
      metaCampaignIds: ids,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("bulk-status error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
