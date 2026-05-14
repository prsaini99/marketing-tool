/**
 * POST /api/ads/bulk-status
 * Body: { action: "pause" | "activate" | "archive", metaAdIds: string[] }
 */

import { NextResponse } from "next/server";
import {
  bulkChangeAdStatus,
  type AdBulkAction,
} from "@/server/services/ads/bulk-status";

const VALID_ACTIONS: AdBulkAction[] = ["pause", "activate", "archive"];

interface Body {
  action?: unknown;
  metaAdIds?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action as AdBulkAction;
  if (typeof action !== "string" || !VALID_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const ids = Array.isArray(body.metaAdIds)
    ? body.metaAdIds.filter((x): x is string => typeof x === "string")
    : null;
  if (!ids || ids.length === 0) {
    return NextResponse.json(
      { error: "metaAdIds must be a non-empty array of strings" },
      { status: 400 },
    );
  }

  try {
    const result = await bulkChangeAdStatus({
      action,
      metaAdIds: ids,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("ads bulk-status error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
