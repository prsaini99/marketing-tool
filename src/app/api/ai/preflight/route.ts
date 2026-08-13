/**
 * POST /api/ai/preflight
 *
 * Body: { adAccountId, primaryText?, headline?, description?, callToAction?, linkUrl? }
 *
 * Scores an ad draft before it is submitted to Meta. Read-only: it touches
 * the LLM and the local mirror, never Meta, and creates nothing — so it is
 * safe to call repeatedly from the create form.
 *
 * `adAccountId` accepts either the local MetaAdAccount.id or the Meta
 * "act_..." id, because the create modal has the Meta id to hand and making
 * the client translate would be gratuitous.
 */

import { NextResponse } from "next/server";
import { runPreflight } from "@/server/services/ai/preflight";

// Three concurrent LLM/vector calls; the default 10s cap is too tight when
// OpenAI is slow.
export const maxDuration = 120;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v : undefined;

  const adAccountId = str(body.adAccountId);
  if (!adAccountId) {
    return NextResponse.json(
      { error: "adAccountId is required" },
      { status: 400 },
    );
  }

  try {
    const result = await runPreflight({
      adAccountId,
      primaryText: str(body.primaryText),
      headline: str(body.headline),
      description: str(body.description),
      callToAction: str(body.callToAction),
      linkUrl: str(body.linkUrl),
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Pre-flight failed";
    // "Not enough ad copy" is a client-state problem, not a server fault —
    // the form calls this while the user is still typing.
    const status = /not enough|not found/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
