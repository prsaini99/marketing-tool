/**
 * POST /api/adsets/bulk-status
 * Body: { action: "pause" | "activate" | "archive", metaAdSetIds: string[] }
 */

import { NextResponse } from "next/server";
import {
  bulkChangeAdSetStatus,
  type AdSetBulkAction,
} from "@/server/services/adsets/bulk-status";

const VALID_ACTIONS: AdSetBulkAction[] = ["pause", "activate", "archive"];

interface Body {
  action?: unknown;
  metaAdSetIds?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action as AdSetBulkAction;
  if (typeof action !== "string" || !VALID_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const ids = Array.isArray(body.metaAdSetIds)
    ? body.metaAdSetIds.filter((x): x is string => typeof x === "string")
    : null;
  if (!ids || ids.length === 0) {
    return NextResponse.json(
      { error: "metaAdSetIds must be a non-empty array of strings" },
      { status: 400 },
    );
  }

  try {
    const result = await bulkChangeAdSetStatus({
      action,
      metaAdSetIds: ids,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("adsets bulk-status error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
