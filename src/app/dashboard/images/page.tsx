/**
 * Image library — raw images uploaded into every selected ad account.
 *
 * Different from /dashboard/creatives: a creative is the *composed* ad
 * (body + headline + image + CTA); this page shows the underlying image
 * assets that creatives reference by `image_hash`. The same image is often
 * reused across many creatives, so seeing them on their own — and being
 * able to grab the hash — is the primary use case here.
 *
 * URL state (search + client filter) follows the same pattern as
 * /campaigns, /creatives, etc.
 */

import Image from "next/image";
import { Image as ImageIcon } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchBar } from "@/components/ui/search-bar";
import { BulkSyncButton } from "@/components/sync/bulk-sync-button";

const STATUS_STYLE: Record<string, { pill: string; label: string }> = {
  ACTIVE: { pill: "bg-green-50 text-green-700", label: "Active" },
  DELETED: { pill: "bg-zinc-100 text-zinc-500", label: "Deleted" },
  INTERNAL: { pill: "bg-blue-50 text-blue-700", label: "Internal" },
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const s = STATUS_STYLE[status] ?? {
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

export default async function ImageLibraryPage({
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

  const rows = await prisma.adImage.findMany({
    where: {
      adAccount: {
        selectedForSync: true,
        ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
      },
      // Search across name + hash so a user can find an image either by the
      // filename Meta stored or by pasting the hash from a creative spec.
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { metaImageHash: { contains: query, mode: "insensitive" } },
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

  const totalAcrossAll = await prisma.adImage.count({
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
            Image library
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {selectedBusiness ? (
              <>
                {rows.length} images under{" "}
                <span className="text-foreground">{selectedBusiness.name}</span>
              </>
            ) : (
              <>{rows.length} images across all connected clients</>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <SearchBar placeholder="Search by name or hash…" />
          <BulkSyncButton
            kind="images"
            accountsInScope={accountsInScope}
            businessId={selectedBusiness?.id ?? null}
          />
        </div>
      </div>

      {totalAcrossAll === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="No images synced yet"
          description="Click Sync now above to pull every image from Meta's ad library for the selected accounts."
        />
      ) : rows.length === 0 && query ? (
        <EmptyState
          icon={ImageIcon}
          title={`No images match “${query}”`}
          description="Try a shorter query, or clear the search to see all images."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title={`No images under ${selectedBusiness?.name ?? "this client"}`}
          description="Switch clients in the top bar, or sync this client's ad accounts."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {rows.map((img) => {
            // Hash is the most useful field here — devs paste it into a
            // creative spec. Truncate visually but keep the full string in
            // the title attribute so click-to-copy can be a later upgrade.
            const shortHash = img.metaImageHash.slice(0, 10) + "…";
            const dims =
              img.width && img.height ? `${img.width} × ${img.height}` : null;
            return (
              <article
                key={img.id}
                className="overflow-hidden rounded-lg border border-border bg-background transition-colors hover:bg-surface"
              >
                {/* Square aspect for a tight, uniform grid — uploaded ad
                    images are wildly varied in aspect, so we object-cover
                    rather than letterbox. */}
                <div className="relative aspect-square w-full bg-surface-2">
                  {img.url ? (
                    <Image
                      src={img.url}
                      alt={img.name ?? img.metaImageHash}
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 1280px) 25vw, 16vw"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-subtle">
                      <ImageIcon className="h-8 w-8" />
                    </div>
                  )}
                </div>

                <div className="space-y-1 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      className="line-clamp-1 text-xs font-medium text-foreground"
                      title={img.name ?? undefined}
                    >
                      {img.name ?? "Untitled"}
                    </h3>
                    <StatusPill status={img.status} />
                  </div>
                  <p
                    className="font-mono text-[10px] text-subtle"
                    title={img.metaImageHash}
                  >
                    {shortHash}
                  </p>
                  <p className="text-[10px] text-subtle">
                    {dims ?? "—"} · {img.adAccount.business.name}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="text-xs text-subtle">
        Showing up to 500 most recently synced images. Image URLs from Meta
        are short-lived — re-sync if thumbnails 404.
      </p>
    </div>
  );
}
