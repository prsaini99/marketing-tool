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

import Image from "next/image";
import { Image as ImageIcon, Video } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchBar } from "@/components/ui/search-bar";
import { BulkSyncButton } from "@/components/sync/bulk-sync-button";
import { NewCreativeButton } from "@/components/creatives/new-creative-button";
import { DeleteButton } from "@/components/common/delete-button";

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

// Meta returns 4 status values for creatives; map each to a pill color +
// human label. Anything unknown falls through to a neutral pill.
const STATUS_STYLE: Record<string, { pill: string; label: string }> = {
  ACTIVE: { pill: "bg-green-50 text-green-700", label: "Active" },
  IN_PROCESS: { pill: "bg-blue-50 text-blue-700", label: "In review" },
  WITH_ISSUES: { pill: "bg-amber-50 text-amber-700", label: "With issues" },
  DELETED: { pill: "bg-zinc-100 text-zinc-500", label: "Deleted" },
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
          metaAdAccountId: true,
          name: true,
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

  return (
    <div className="space-y-4">
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((c) => {
            const ctaLabel = c.callToActionType
              ? (CTA_LABEL[c.callToActionType] ?? c.callToActionType)
              : null;
            const thumb = c.thumbnailUrl ?? c.imageUrl;
            const isVideo = Boolean(c.videoId);
            return (
              <article
                key={c.id}
                className="overflow-hidden rounded-lg border border-border bg-background transition-colors hover:bg-surface"
              >
                {/* Thumbnail (or fallback). 16:9 keeps the grid uniform even
                    when Meta gives us portrait or square images. */}
                <div className="relative aspect-video w-full bg-surface-2">
                  {thumb ? (
                    <Image
                      src={thumb}
                      alt={c.title ?? c.name ?? "Creative thumbnail"}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1280px) 33vw, 25vw"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-subtle">
                      {isVideo ? (
                        <Video className="h-8 w-8" />
                      ) : (
                        <ImageIcon className="h-8 w-8" />
                      )}
                    </div>
                  )}
                  {isVideo && thumb && (
                    <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      Video
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      className="line-clamp-1 text-sm font-medium text-foreground"
                      title={c.name ?? undefined}
                    >
                      {c.name ?? c.title ?? "Untitled creative"}
                    </h3>
                    <StatusPill status={c.status} />
                  </div>

                  {c.title && c.title !== c.name && (
                    <p
                      className="line-clamp-1 text-xs text-foreground"
                      title={c.title}
                    >
                      {c.title}
                    </p>
                  )}
                  {c.body && (
                    <p className="line-clamp-2 text-xs text-muted">{c.body}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {ctaLabel && (
                      <span className="inline-flex items-center rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                        {ctaLabel}
                      </span>
                    )}
                    <span className="text-[10px] text-subtle">
                      {c.adAccount.business.name} · {c.adAccount.name}
                    </span>
                  </div>
                  <div className="flex justify-end border-t border-border pt-1.5">
                    <DeleteButton
                      entityType="creative"
                      metaId={c.metaCreativeId}
                      name={c.name ?? c.title ?? "this creative"}
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="text-xs text-subtle">
        Showing up to 500 most recently synced creatives. Sync an account to
        refresh; idempotent, so re-running is safe.
      </p>
    </div>
  );
}
