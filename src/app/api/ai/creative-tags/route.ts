/**
 * GET  /api/ai/creative-tags?adAccountId=&dimension=&minCreatives=
 *   → tag groups joined to real performance (spend, CTR, ROAS, CPA)
 *
 * POST /api/ai/creative-tags
 *   body: { adAccountId, force? }
 *   → classify this account's indexed creatives
 *
 * `adAccountId` is the LOCAL MetaAdAccount.id. Classification reads the
 * embeddings written by the ad-copy indexer, so an account that has never
 * been indexed returns totalIndexed: 0 rather than an error — "run the
 * reindex first" is a state, not a failure.
 */

import { NextResponse } from "next/server";
import {
  classifyCreativesForAccount,
  getTagPerformance,
  type TagDimension,
} from "@/server/services/ai/classify-creatives";
import { analyzeAccountMedia } from "@/server/services/ai/analyze-media";

// Classification is a sequence of LLM calls; the default 10s cap is far too
// short for an account with a few hundred creatives.
export const maxDuration = 300;

const DIMENSIONS: TagDimension[] = ["hookType", "angle", "funnelStage"];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const adAccountId = searchParams.get("adAccountId");
  if (!adAccountId) {
    return NextResponse.json(
      { error: "adAccountId is required" },
      { status: 400 },
    );
  }

  const raw = searchParams.get("dimension") ?? "hookType";
  const dimension = (DIMENSIONS as string[]).includes(raw)
    ? (raw as TagDimension)
    : "hookType";

  const minParam = Number(searchParams.get("minCreatives"));
  const minCreatives =
    Number.isFinite(minParam) && minParam > 0 ? Math.floor(minParam) : 1;

  try {
    const data = await getTagPerformance(adAccountId, dimension, {
      minCreatives,
    });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to read tags" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: { adAccountId?: unknown; force?: unknown; skipMedia?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.adAccountId !== "string" || !body.adAccountId) {
    return NextResponse.json(
      { error: "adAccountId is required" },
      { status: 400 },
    );
  }

  try {
    // Analyse media first (cached — only new assets cost anything), then
    // classify. If analysis produced anything new, existing tags were made
    // from less information than is now available, so the pass is forced:
    // a stale copy-only tag sitting next to a fresh transcript would never
    // self-correct otherwise.
    const media =
      body.skipMedia === true
        ? null
        : await analyzeAccountMedia(body.adAccountId, {
            // Describe the WHOLE library, not only images a creative already
            // references. The campaign copilot chooses assets from the full
            // library and sees nothing but a filename for anything
            // undescribed, so limiting analysis to in-use creatives left most
            // of the library invisible to it.
            includeUnreferenced: true,
          });
    const result = await classifyCreativesForAccount(body.adAccountId, {
      force: body.force === true || media?.producedNew === true,
    });
    return NextResponse.json({ ...result, media });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Classification failed" },
      { status: 500 },
    );
  }
}
