/**
 * GET /api/cron/reindex/ad-copy
 *
 * Nightly safety-net that refreshes the ad-copy RAG index across every
 * selected-for-sync account. Performance metadata (ROAS / CTR / spend)
 * is computed at index time, so this keeps it fresh as new insights
 * land overnight — otherwise the cross-account winners search would
 * re-rank against stale numbers.
 *
 * The per-account auto-reindex on creatives sync handles new / edited
 * creatives in real time. This cron specifically handles the case where
 * the CREATIVES didn't change but the PERFORMANCE did (insights synced,
 * yesterday's spend & ROAS landed). Without it, a winner's ROAS would
 * stay frozen at whatever it was last time the creative was synced.
 *
 * Auth: optional. If CRON_SECRET is set in env, we require the standard
 * `Authorization: Bearer <secret>` header (Vercel Cron sends it
 * automatically). When the secret isn't set, any caller goes through —
 * fine in dev, tighten when you ship to a hostile environment.
 */

import { NextResponse } from "next/server";
import { reindexAllAccountsAdCopy } from "@/server/services/ai/index-ad-copy";

// Indexing every creative across every account at OpenAI's embeddings
// endpoint can take a couple of minutes for a busy agency. Lift the
// default 10s ceiling.
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
    const result = await reindexAllAccountsAdCopy();
    return NextResponse.json(result);
  } catch (err) {
    console.error("cron reindex/ad-copy error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
