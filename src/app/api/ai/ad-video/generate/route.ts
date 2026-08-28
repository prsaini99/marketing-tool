/**
 * POST /api/ai/ad-video/generate
 *
 * Queues a five-second text-to-video ad via Higgsfield's Kling v2.1 Master.
 * A GPT shot stage (video-shot.ts) turns the brief into a concrete shot
 * before the vendor call, and the job is persisted so the client can poll
 * it rather than holding the request open for the whole render.
 *
 * Body: { formatId, brief, placement?, businessId?, brand?, toggles?, brandContext? }
 * Returns 202 { id, angle, note }.
 */

import { NextResponse } from "next/server";
import { higgsfieldConfigured } from "@/lib/higgsfield/client";
import { getVideoFormat } from "@/server/services/ai/video-formats";
import {
  startVideoGeneration,
  VideoGenerationError,
} from "@/server/services/video/generation";
import type { VideoBrand, VideoToggles } from "@/server/services/ai/video-prompt";
import type { BrandContext } from "@/server/services/ai/ad-copy";

// A queued video plus the GPT shot stage; the vendor call itself is fast but
// the shot stage can take a few seconds.
export const maxDuration = 60;

/** Trimmed string, or null for anything else. */
function optionalText(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function parseBrand(v: unknown): VideoBrand | null | "invalid" {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object") return "invalid";
  const obj = v as Record<string, unknown>;
  if (!Array.isArray(obj.palette) || !obj.palette.every((c) => typeof c === "string")) {
    return "invalid";
  }
  for (const field of ["themeNotes", "brandName", "tagline", "avoidNotes"]) {
    const value = obj[field];
    if (value !== null && value !== undefined && typeof value !== "string") {
      return "invalid";
    }
  }
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    palette: obj.palette,
    themeNotes: str(obj.themeNotes),
    brandName: str(obj.brandName),
    tagline: str(obj.tagline),
    avoidNotes: str(obj.avoidNotes),
  };
}

function parseToggles(v: unknown): VideoToggles | "invalid" {
  if (v === undefined) {
    return {
      useColours: true,
      useTheme: true,
      useLogo: true,
      useIdentity: true,
      useAvoid: true,
    };
  }
  if (typeof v !== "object" || v === null) return "invalid";
  const obj = v as Record<string, unknown>;
  const flags = ["useColours", "useTheme", "useLogo", "useIdentity", "useAvoid"] as const;
  if (flags.some((f) => typeof obj[f] !== "boolean")) return "invalid";
  return {
    useColours: obj.useColours as boolean,
    useTheme: obj.useTheme as boolean,
    useLogo: obj.useLogo as boolean,
    useIdentity: obj.useIdentity as boolean,
    useAvoid: obj.useAvoid as boolean,
  };
}

/**
 * Both kinds of VideoGenerationError carry text meant to be read: the vendor's
 * own words, or a line the service wrote. Anything else is unplanned, and a
 * Prisma error is the one unplanned throw we know reaches here (a stale
 * businessId, a dropped connection) — its message names our tables and helps
 * the operator not at all, so it is replaced. Any other stray error still
 * forwards, because losing an upstream vendor's reason is the worse mistake.
 */
function publicError(err: unknown): string {
  if (err instanceof VideoGenerationError) return err.message;
  if (err instanceof Error) {
    if (err.name.startsWith("PrismaClient")) {
      return "Something went wrong recording this generation. Check Recent generations before trying again.";
    }
    return err.message;
  }
  return "Video generation failed";
}

export async function POST(req: Request) {
  if (!higgsfieldConfigured()) {
    // Off, not broken — the operator can act on this, a 500 tells them nothing.
    return NextResponse.json(
      { error: "Video generation isn't configured. Add HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET." },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const formatId = typeof body.formatId === "string" ? body.formatId : "";
  const format = getVideoFormat(formatId);
  if (!format) {
    return NextResponse.json(
      { error: `Unknown format "${formatId}"` },
      { status: 400 },
    );
  }

  // No one-click path for video: the shot stage needs something to work from,
  // and a five-second clip costs too much to generate from nothing.
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (!brief) {
    return NextResponse.json(
      { error: "A brief is required for video." },
      { status: 400 },
    );
  }

  const brand = parseBrand(body.brand);
  if (brand === "invalid") {
    return NextResponse.json(
      { error: "brand must be { palette: string[], themeNotes, brandName, tagline, avoidNotes: string | null }" },
      { status: 400 },
    );
  }

  const toggles = parseToggles(body.toggles);
  if (toggles === "invalid") {
    return NextResponse.json(
      { error: "toggles must be { useColours, useTheme, useLogo, useIdentity, useAvoid }: boolean" },
      { status: 400 },
    );
  }

  // Same shape as BrandContext in ad-copy.ts: description/audience/tone go to
  // the shot stage only, never to the vendor prompt as literal text.
  const rawContext = body.brandContext;
  const brandContext: BrandContext | null =
    rawContext && typeof rawContext === "object"
      ? {
          description: optionalText((rawContext as Record<string, unknown>).description),
          audience: optionalText((rawContext as Record<string, unknown>).audience),
          toneOfVoice: optionalText((rawContext as Record<string, unknown>).toneOfVoice),
        }
      : null;

  const businessId =
    typeof body.businessId === "string" && body.businessId.trim()
      ? body.businessId.trim()
      : null;

  try {
    const result = await startVideoGeneration({
      businessId,
      format,
      brief,
      placementId: typeof body.placement === "string" ? body.placement : "feed-square",
      brand,
      toggles,
      context: brandContext,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    console.error("ad-video generate error:", err);
    // The vendor's own message is the only text that says what to fix, so it
    // is forwarded verbatim — the same reasoning as readMetaError in
    // src/lib/meta/client.ts. Our own plumbing failures are a different
    // thing: a raw Prisma error in the browser tells the operator nothing
    // and leaks our schema, so the service hands over a written line instead
    // and the detail stays in the log above. 502 either way: the request
    // didn't produce a video, and the distinction the operator acts on is
    // the message, not the code.
    return NextResponse.json({ error: publicError(err) }, { status: 502 });
  }
}
