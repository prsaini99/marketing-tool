/**
 * POST /api/ai/ad-copy/reindex
 *
 * Backfill brand-voice embeddings for one account — call once after the
 * creatives sync to populate the RAG corpus for generation. Idempotent.
 *
 * Body: { accountId }
 * Returns: { totalCreatives, indexed, skipped }
 */

import { NextResponse } from "next/server";
import { backfillAdCopyForAccount } from "@/server/services/ai/index-ad-copy";

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
    const result = await backfillAdCopyForAccount(body.accountId.trim());
    return NextResponse.json(result);
  } catch (err) {
    console.error("ad-copy reindex error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
