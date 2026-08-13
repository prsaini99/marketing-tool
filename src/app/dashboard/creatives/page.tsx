/**
 * Creatives library — flat grid view across every selected ad account.
 *
 * A "creative" is the design half of an ad (body text, headline, image/video,
 * link, CTA), reusable across many ads. We mirror them into the AdCreative
 * table on the "creatives" sync kind. This page is mostly visual: a grid of
 * cards instead of the table layouts used elsewhere, because the thumbnail
 * is the point.
 *
 * URL state (search + client filter) follows the same pattern as
 * /campaigns, /adsets, /ads.
 */

import { SubNav, LIBRARY_TABS } from "@/components/layout/sub-nav";
import { Image as ImageIcon } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { mediaUrl } from "@/lib/media-url";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchBar } from "@/components/ui/search-bar";
import { BulkSyncButton } from "@/components/sync/bulk-sync-button";
import { NewCreativeButton } from "@/components/creatives/new-creative-button";
import { CreativeGallery, type GalleryItem } from "@/components/creatives/creative-gallery";
import { HOOK_LABELS, ANGLE_LABELS, type HookType, type CreativeAngle } from "@/lib/creative-taxonomy";

// Map Meta's call_to_action_type enum to readable labels.
const CTA_LABEL: Record<string, string> = {
  SHOP_NOW: "Shop now",
  LEARN_MORE: "Learn more",
  SIGN_UP: "Sign up",
  BOOK_TRAVEL: "Book now",
  DOWNLOAD: "Download",
  GET_QUOTE: "Get quote",
  CONTACT_US: "Contact us",
  APPLY_NOW: "Apply now",
  SUBSCRIBE: "Subscribe",
  WATCH_MORE: "Watch more",
  GET_OFFER: "Get offer",
  ORDER_NOW: "Order now",
  INSTALL_APP: "Install app",
  USE_APP: "Use app",
};

export default async function CreativesFlatPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; q?: string }>;
}) {
  const { client, q } = await searchParams;
  const query = q?.trim();
  const selectedBusiness = client
    ? await prisma.metaBusiness.findUnique({
        where: { id: client },
        select: { id: true, name: true },
      })
    : null;

  const rows = await prisma.adCreative.findMany({
    where: {
      adAccount: {
        selectedForSync: true,
        ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
      },
      // Search is OR across name + headline + body so the user can find a
      // creative whether they remember its label or one of the copy lines.
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { title: { contains: query, mode: "insensitive" } },
              { body: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      adAccount: {
        select: {
          id: true,
          metaAdAccountId: true,
          name: true,
          currency: true,
          business: { select: { name: true } },
        },
      },
    },
    orderBy: { syncedAt: "desc" },
    take: 500,
  });

  const totalAcrossAll = await prisma.adCreative.count({
    where: { adAccount: { selectedForSync: true } },
  });

  // Accounts the bulk Sync button hits + the New-creative account picker.
  // Scoped by client filter; de-duped by Meta id.
  const scopeAccounts = await prisma.metaAdAccount.findMany({
    where: {
      selectedForSync: true,
      ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
    },
    select: {
      metaAdAccountId: true,
      name: true,
      business: { select: { name: true } },
    },
    distinct: ["metaAdAccountId"],
    orderBy: [{ business: { name: "asc" } }, { name: "asc" }],
  });
  const accountsInScope = scopeAccounts.length;
  const accountOptions = scopeAccounts.map((a) => ({
    metaAdAccountId: a.metaAdAccountId,
    name: a.name,
    businessName: a.business.name,
  }));

  const activeCount = rows.filter((r) => r.status === "ACTIVE").length;
  const issuesCount = rows.filter((r) => r.status === "WITH_ISSUES").length;

  // The intelligence layer: AI tags + performance live on each creative's
  // embedding row (written by classify-creatives), transcripts on AdVideo.
  // Fetched here in two batch queries so the gallery cards can surface what
  // the platform actually knows instead of a raw CTA enum.
  const creativeIds = rows.map((r) => r.metaCreativeId);
  const videoIds = rows.map((r) => r.videoId).filter(Boolean) as string[];
  const imageHashes = rows.map((r) => r.imageHash).filter(Boolean) as string[];
  const [embRows, videoRows, imageRows] = await Promise.all([
    creativeIds.length
      ? (prisma.embedding.findMany({
          where: {
            namespace: "ads",
            sourceType: "AdCreative",
            sourceId: { in: creativeIds },
          },
          select: { sourceId: true, metadata: true },
        }) as unknown as Promise<Array<{ sourceId: string; metadata: Record<string, unknown> | null }>>)
      : Promise.resolve([]),
    videoIds.length
      ? prisma.adVideo.findMany({
          where: { metaVideoId: { in: videoIds } },
          select: {
            metaVideoId: true,
            sourceUrl: true,
            transcript: true,
            thumbnailUrl: true,
          },
        })
      : Promise.resolve([]),
    // Full-resolution originals. The creative row only carries Meta's t45
    // AD THUMBNAIL — a ~64px preview that upscales into mush — while the
    // image library holds the same asset at full size (1080px+), keyed by
    // the identical content hash. Joining here is the whole image-quality
    // fix: cards and the detail view render the original, never the thumb.
    imageHashes.length
      ? prisma.adImage.findMany({
          where: { metaImageHash: { in: imageHashes }, url: { not: null } },
          select: { metaImageHash: true, url: true, storagePath: true },
        })
      : Promise.resolve([]),
  ]);
  const metaBySource = new Map(embRows.map((e) => [e.sourceId, e.metadata ?? {}]));
  const videoById = new Map(videoRows.map((v) => [v.metaVideoId, v]));
  // mediaUrl prefers the captured bytes; Meta's URL is only the fallback,
  // because it stops resolving within about a day.
  const fullImageByHash = new Map(
    imageRows.map((i) => [i.metaImageHash, mediaUrl(i)]),
  );

  const symbolFor = (c: string) =>
    c === "INR" ? "₹" : c === "USD" ? "$" : c === "EUR" ? "€" : c === "GBP" ? "£" : "";

  const galleryItems: GalleryItem[] = rows.map((c) => {
    const md = metaBySource.get(c.metaCreativeId);
    const video = c.videoId ? videoById.get(c.videoId) : null;
    const spendCents = Number(md?.spendCents ?? 0);
    const conversions = Number(md?.conversionsCount ?? 0);
    const hook = typeof md?.hookType === "string" ? (HOOK_LABELS[md.hookType as HookType] ?? null) : null;
    const angle = typeof md?.angle === "string" ? (ANGLE_LABELS[md.angle as CreativeAngle] ?? null) : null;
    return {
      id: c.id,
      metaCreativeId: c.metaCreativeId,
      name: c.name,
      title: c.title,
      body: c.body,
      ctaLabel: c.callToActionType ? (CTA_LABEL[c.callToActionType] ?? c.callToActionType) : null,
      linkUrl: c.linkUrl,
      status: c.status,
      // Fallback chain deliberately EXCLUDES AdVideo.thumbnailUrl: those
      // t15 assets expire per-sync and hotlink-block in browsers even while
      // curl sees 200s. Fresh-source videos render as <video> (sharpest
      // possible); everything else uses the creative's own t45 thumb, which
      // is small but reliably served.
      thumb:
        (c.imageHash ? fullImageByHash.get(c.imageHash) : null) ??
        // The creative's own captured thumbnail, then whatever Meta still
        // serves. Stored bytes always win.
        mediaUrl(c) ??
        c.imageUrl ??
        null,
      isVideo: Boolean(c.videoId),
      videoSourceUrl: video?.sourceUrl ?? null,
      transcript: video?.transcript || null,
      accountLabel: `${c.adAccount.business.name} · ${c.adAccount.name}`,
      tags: md
        ? {
            hook,
            angle,
            funnel: typeof md.funnelStage === "string" ? md.funnelStage : null,
            usp: typeof md.usp === "string" && md.usp ? md.usp : null,
            persona: typeof md.persona === "string" && md.persona ? md.persona : null,
            mediaUsed: md.mediaUsed === true,
          }
        : null,
      perf: md
        ? {
            spendCents,
            ctr: Number(md.ctr ?? 0),
            conversions,
            cpaCents: conversions > 0 ? Math.round(spendCents / conversions) : null,
          }
        : null,
      currencySymbol: symbolFor(c.adAccount.currency),
    };
  });

  return (
    <div className="space-y-4">
      <SubNav items={LIBRARY_TABS} />
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Creatives</h1>
          <p className="mt-0.5 text-sm text-muted">
            {selectedBusiness ? (
              <>
                {rows.length} creatives under{" "}
                <span className="text-foreground">{selectedBusiness.name}</span>{" "}
                · {activeCount} active · {issuesCount} with issues
              </>
            ) : (
              <>
                {rows.length} creatives across all connected clients ·{" "}
                {activeCount} active · {issuesCount} with issues
              </>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <SearchBar placeholder="Search creatives…" />
          <BulkSyncButton
            kind="creatives"
            accountsInScope={accountsInScope}
            businessId={selectedBusiness?.id ?? null}
          />
          <NewCreativeButton accounts={accountOptions} />
        </div>
      </div>

      {totalAcrossAll === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="No creatives synced yet"
          description="Drill into an ad account and click Sync now to pull creatives from Meta."
          action={{
            label: "Go to accounts",
            href: "/dashboard/accounts",
          }}
        />
      ) : rows.length === 0 && query ? (
        <EmptyState
          icon={ImageIcon}
          title={`No creatives match “${query}”`}
          description="Try a shorter query, or clear the search to see all creatives."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title={`No creatives under ${selectedBusiness?.name ?? "this client"}`}
          description="Switch clients in the top bar, or sync this client's ad accounts."
        />
      ) : (
        <CreativeGallery items={galleryItems} />
      )}

      <p className="text-xs text-subtle">
        Showing up to 500 most recently synced creatives. Sync an account to
        refresh; idempotent, so re-running is safe.
      </p>
    </div>
  );
}
