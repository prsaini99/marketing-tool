/**
 * Video library — raw videos uploaded into every selected ad account.
 *
 * Counterpart to /dashboard/images. Same browse-grid pattern; the only
 * meaningful UX difference is the play-icon overlay on each tile + a
 * length badge ("0:30") so the user can scan durations without playing
 * each clip. Click → opens the mp4 in a new tab (cheap, no inline player
 * to maintain).
 */

import Image from "next/image";
import { PlayCircle, Video as VideoIcon } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchBar } from "@/components/ui/search-bar";
import { BulkSyncButton } from "@/components/sync/bulk-sync-button";

// Meta's video status values are lowercase; map the common ones. Anything
// unknown falls through to a neutral pill.
const STATUS_STYLE: Record<string, { pill: string; label: string }> = {
  ready: { pill: "bg-green-50 text-green-700", label: "Ready" },
  processing: { pill: "bg-blue-50 text-blue-700", label: "Processing" },
  upload_complete: { pill: "bg-blue-50 text-blue-700", label: "Uploading" },
  error: { pill: "bg-amber-50 text-amber-700", label: "Error" },
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const key = status.toLowerCase();
  const s = STATUS_STYLE[key] ?? {
    pill: "bg-zinc-100 text-zinc-600",
    label: status,
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        s.pill,
      )}
    >
      {s.label}
    </span>
  );
}

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

  const accountsInScope = await prisma.metaAdAccount.count({
    where: {
      selectedForSync: true,
      ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
    },
  });

  return (
    <div className="space-y-4">
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((v) => {
            const length = formatLength(v.lengthSeconds);
            // Open the mp4 in a new tab when the tile has a sourceUrl —
            // keeps this page light (no inline <video> elements to manage).
            const TileWrap = ({ children }: { children: React.ReactNode }) =>
              v.sourceUrl ? (
                <a
                  href={v.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  {children}
                </a>
              ) : (
                <div>{children}</div>
              );
            return (
              <article
                key={v.id}
                className="overflow-hidden rounded-lg border border-border bg-background transition-colors hover:bg-surface"
              >
                <TileWrap>
                  <div className="group relative aspect-video w-full bg-surface-2">
                    {v.thumbnailUrl ? (
                      <Image
                        src={v.thumbnailUrl}
                        alt={v.title ?? v.metaVideoId}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 25vw"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-subtle">
                        <VideoIcon className="h-10 w-10" />
                      </div>
                    )}
                    {/* Play overlay only when there's a clickable source —
                        otherwise it'd be a fake affordance. */}
                    {v.sourceUrl && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                        <PlayCircle className="h-12 w-12 text-white opacity-80 drop-shadow" />
                      </div>
                    )}
                    {length && (
                      <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white">
                        {length}
                      </span>
                    )}
                  </div>
                </TileWrap>

                <div className="space-y-1 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      className="line-clamp-1 text-sm font-medium text-foreground"
                      title={v.title ?? undefined}
                    >
                      {v.title ?? "Untitled video"}
                    </h3>
                    <StatusPill status={v.status} />
                  </div>
                  {v.description && (
                    <p className="line-clamp-2 text-xs text-muted">
                      {v.description}
                    </p>
                  )}
                  <p
                    className="font-mono text-[10px] text-subtle"
                    title={v.metaVideoId}
                  >
                    {v.metaVideoId}
                  </p>
                  <p className="text-[10px] text-subtle">
                    {v.adAccount.business.name} · {v.adAccount.name}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="text-xs text-subtle">
        Showing up to 500 most recently synced videos. Source URLs from Meta
        are short-lived — re-sync if a clip 404s.
      </p>
    </div>
  );
}
