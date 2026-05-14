/**
 * GET /api/ads/[id]/previews?formats=A,B,C
 *
 * Returns Meta-rendered iframe previews for the requested placement formats.
 * Default behaviour (no `formats` param) returns only the single default
 * placement — the modal opens with one call and lazy-loads the rest.
 *
 * Differentiator vs Meta's UI: Meta's dialog shows one placement at a time
 * behind a dropdown; our modal can render all of them side-by-side once
 * the user explicitly asks for it (the "Show all placements" toggle).
 *
 * `id` in the URL is the Meta ad id (the one shown in the ads table).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { metaClient } from "@/lib/meta/client";
import {
  AD_PLACEMENT_FORMATS,
  DEFAULT_PLACEMENT_FORMAT,
  getPlacementLabel,
} from "@/lib/meta/ad-placements";

const SUPPORTED_FORMATS = new Set(AD_PLACEMENT_FORMATS);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: metaAdId } = await params;
  const url = new URL(req.url);

  // Comma-separated formats; default to a single placement so opening the
  // modal costs one Meta call, not five.
  const rawFormats = url.searchParams.get("formats");
  const requested = rawFormats
    ? rawFormats
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [DEFAULT_PLACEMENT_FORMAT];

  const formats = requested.filter((f) => SUPPORTED_FORMATS.has(f));
  if (formats.length === 0) {
    return NextResponse.json(
      {
        error: `formats must be a subset of: ${AD_PLACEMENT_FORMATS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const ad = await prisma.ad.findFirst({
    where: {
      metaAdId,
      adAccount: { selectedForSync: true },
    },
    include: {
      adAccount: {
        include: {
          business: { include: { connection: true } },
        },
      },
    },
  });

  if (!ad) {
    return NextResponse.json(
      { error: "Ad not found in any selected-for-sync account" },
      { status: 404 },
    );
  }

  try {
    const results = await metaClient.getAdPreviews(
      ad.adAccount.business.connection.id,
      metaAdId,
      formats,
    );

    const previews = results.map((r) => ({
      format: r.format,
      label: getPlacementLabel(r.format),
      html: r.html ?? null,
      error: r.error,
    }));

    return NextResponse.json({ previews });
  } catch (err) {
    console.error("ad previews error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
