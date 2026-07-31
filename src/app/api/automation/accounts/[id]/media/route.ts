/**
 * GET /api/automation/accounts/[id]/media — posts for the rule editor's
 * targeting dropdown. Live Meta passthrough, no mirror.
 *
 * Returns BOTH organic feed posts and ad posts. Ads matter here because ad
 * creatives are usually "dark posts": they never appear in
 * /{ig-user-id}/media, so without this a rule could not target the very
 * posts driving paid traffic — which are the ones most likely to attract
 * comments worth answering.
 *
 * Organic and ad lists are fetched independently: an ad-account permission
 * problem must not blank out the organic list (and vice versa), so each is
 * tried separately and its error reported alongside whatever did load.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  listAdFacebookPosts,
  listAdInstagramMedia,
  listPagePosts,
  listRecentMedia,
  type IgMediaSummary,
} from "@/lib/meta/messaging";

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ig = await prisma.socialAccount.findUnique({
    where: { id },
    select: { accountId: true, connectionId: true, platform: true },
  });
  if (!ig) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isFacebook = ig.platform === "FACEBOOK";

  let organic: IgMediaSummary[] = [];
  let organicError: string | null = null;
  try {
    organic = isFacebook
      ? await listPagePosts(ig.connectionId, ig.accountId)
      : await listRecentMedia(ig.connectionId, ig.accountId);
  } catch (e) {
    organicError = msg(e);
  }

  const adAccounts = await prisma.metaAdAccount.findMany({
    where: { business: { connectionId: ig.connectionId } },
    select: { metaAdAccountId: true },
  });

  const ads: IgMediaSummary[] = [];
  let adsError: string | null = null;
  for (const acct of adAccounts) {
    try {
      ads.push(
        ...(isFacebook
          ? await listAdFacebookPosts(ig.connectionId, acct.metaAdAccountId)
          : await listAdInstagramMedia(ig.connectionId, acct.metaAdAccountId)),
      );
    } catch (e) {
      adsError = msg(e);
    }
  }

  // An ad post can also exist organically (a boosted post). Keep one entry
  // per media id, preferring the ad record so the UI can show its delivery
  // status — the operator cares more about "is this ad live" than about the
  // organic timestamp.
  const seen = new Set(ads.map((a) => a.id));
  const media = [...ads, ...organic.filter((o) => !seen.has(o.id))];

  // Both sources failed and nothing loaded: that's a real error, not an
  // empty list, so say so rather than rendering an empty dropdown.
  if (organicError && adsError && media.length === 0) {
    return NextResponse.json({ error: organicError }, { status: 502 });
  }

  return NextResponse.json({
    media,
    counts: { organic: organic.length, ads: ads.length },
    errors: { organic: organicError, ads: adsError },
  });
}
