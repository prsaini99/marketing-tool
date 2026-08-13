/**
 * Campaign copilot page.
 *
 * Server component picks the account (URL param, else the first selected one)
 * and hands off to the client panel. Nothing here writes, and the panel has
 * no execute path, so this page is safe to open on a live account.
 */

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import {
  CampaignCopilot,
  type PickerAsset,
} from "@/components/ai/campaign-copilot";
import { mediaUrl } from "@/lib/media-url";

export const dynamic = "force-dynamic";

export default async function CopilotPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const { account } = await searchParams;

  const accounts = await prisma.metaAdAccount.findMany({
    where: { selectedForSync: true },
    select: {
      id: true,
      name: true,
      currency: true,
      business: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  if (!accounts.length) {
    return (
      <div className="mx-auto w-full max-w-5xl px-5 py-10">
        <EmptyState
          icon={Sparkles}
          title="No ad accounts selected"
          description="Connect a business and select an ad account for sync before drafting a campaign."
        />
      </div>
    );
  }

  const active = accounts.find((a) => a.id === account) ?? accounts[0];

  // Library for the pin picker. Fetched server-side and passed down rather
  // than exposed as another endpoint: the page already renders per account,
  // and mediaUrl() needs storagePath, which is a server concern.
  //
  // Analysed assets sort first because those are the ones the agent can
  // actually reason about; an undescribed image is one it would pick by
  // filename.
  const [libImages, libVideos] = await Promise.all([
    prisma.adImage.findMany({
      where: { adAccountId: active.id },
      select: {
        metaImageHash: true,
        name: true,
        aiDescription: true,
        storagePath: true,
        url: true,
      },
      orderBy: [{ aiDescription: { sort: "desc", nulls: "last" } }, { syncedAt: "desc" }],
      take: 60,
    }),
    prisma.adVideo.findMany({
      where: { adAccountId: active.id, status: "ready" },
      select: {
        metaVideoId: true,
        title: true,
        transcript: true,
        storagePath: true,
        thumbnailUrl: true,
      },
      orderBy: [{ transcript: { sort: "desc", nulls: "last" } }, { syncedAt: "desc" }],
      take: 60,
    }),
  ]);

  const assets: PickerAsset[] = [
    ...libImages.map((i) => ({
      kind: "image" as const,
      id: i.metaImageHash,
      name: i.name ?? "Untitled image",
      thumb: mediaUrl(i),
      insight: i.aiDescription?.slice(0, 140) ?? null,
    })),
    ...libVideos.map((v) => ({
      kind: "video" as const,
      id: v.metaVideoId,
      name: v.title ?? "Untitled video",
      thumb: mediaUrl(v),
      insight: v.transcript?.slice(0, 140) ?? null,
    })),
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1
            className="text-3xl font-bold tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Campaign copilot
          </h1>
          <p className="mt-1.5 text-[15px] text-muted">
            Describe a campaign in plain English. You get back a full plan,
            checked against Meta&apos;s rules before anything is created.
          </p>
        </div>
      </div>

      {accounts.length > 1 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {accounts.map((a) => (
            <Link
              key={a.id}
              href={`/dashboard/copilot?account=${a.id}`}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                a.id === active.id
                  ? "bg-accent text-accent-foreground"
                  : "border border-border text-muted hover:text-foreground"
              }`}
            >
              {a.name ?? a.business.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8">
        <CampaignCopilot
          adAccountId={active.id}
          accountName={active.name ?? active.business.name}
          assets={assets}
        />
      </div>
    </div>
  );
}
