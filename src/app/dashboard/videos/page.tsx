/**
 * Video library — raw videos uploaded into every selected ad account.
 *
 * Counterpart to /dashboard/images. Same browse-grid pattern; the only
 * meaningful UX difference is the play-icon overlay on each tile + a
 * length badge ("0:30") so the user can scan durations without playing
 * each clip. Click → opens the mp4 in a new tab (cheap, no inline player
 * to maintain).
 */

import { SubNav, LIBRARY_TABS } from "@/components/layout/sub-nav";
import { Video as VideoIcon } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchBar } from "@/components/ui/search-bar";
import { BulkSyncButton } from "@/components/sync/bulk-sync-button";
import { UploadVideoButton } from "@/components/videos/upload-video-button";
import { VideoGallery, type VideoItem } from "@/components/videos/video-gallery";

// Format a length in seconds as M:SS (e.g. 0:08, 1:23, 12:45). Returns null
// for null/0 so the caller can omit the badge entirely.
function formatLength(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default async function VideoLibraryPage({
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

  const rows = await prisma.adVideo.findMany({
    where: {
      adAccount: {
        selectedForSync: true,
        ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
      },
      // Search title / description / video id so a user can find a clip
      // whether they remember the label or have a creative's video_id.
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { description: { contains: query, mode: "insensitive" } },
              { metaVideoId: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      adAccount: {
        select: {
          metaAdAccountId: true,
          name: true,
          business: { select: { name: true } },
        },
      },
    },
    orderBy: { syncedAt: "desc" },
    take: 500,
  });

  const totalAcrossAll = await prisma.adVideo.count({
    where: { adAccount: { selectedForSync: true } },
  });

  // Accounts the bulk Sync button hits + the Upload-video account picker.
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

  const galleryItems: VideoItem[] = rows.map((v) => ({
    id: v.id,
    metaVideoId: v.metaVideoId,
    title: v.title,
    description: v.description,
    status: v.status,
    length: formatLength(v.lengthSeconds),
    sourceUrl: v.sourceUrl,
    transcript: v.transcript || null,
    accountLabel: `${v.adAccount.business.name} · ${v.adAccount.name}`,
  }));

  return (
    <div className="space-y-4">
      <SubNav items={LIBRARY_TABS} />
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Video library
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {selectedBusiness ? (
              <>
                {rows.length} videos under{" "}
                <span className="text-foreground">{selectedBusiness.name}</span>
              </>
            ) : (
              <>{rows.length} videos across all connected clients</>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <SearchBar placeholder="Search title or video id…" />
          <BulkSyncButton
            kind="videos"
            accountsInScope={accountsInScope}
            businessId={selectedBusiness?.id ?? null}
          />
          <UploadVideoButton accounts={accountOptions} />
        </div>
      </div>

      {totalAcrossAll === 0 ? (
        <EmptyState
          icon={VideoIcon}
          title="No videos synced yet"
          description="Click Sync now above to pull every video from Meta's ad library for the selected accounts."
        />
      ) : rows.length === 0 && query ? (
        <EmptyState
          icon={VideoIcon}
          title={`No videos match “${query}”`}
          description="Try a shorter query, or clear the search to see all videos."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={VideoIcon}
          title={`No videos under ${selectedBusiness?.name ?? "this client"}`}
          description="Switch clients in the top bar, or sync this client's ad accounts."
        />
      ) : (
        <VideoGallery items={galleryItems} />
      )}

      <p className="text-xs text-subtle">
        Showing up to 500 most recently synced videos. Source URLs from Meta
        are short-lived, so re-sync if a clip 404s.
      </p>
    </div>
  );
}
