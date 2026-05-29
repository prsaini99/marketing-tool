/**
 * GET /api/creatives?accountId=<act_... | ...>
 *
 * Returns the synced creatives for one ad account, used by the Edit Ad
 * modal's "swap creative" picker. Lazy-loaded when the modal opens so we
 * don't ship every account's creatives into every ads-table render.
 *
 * Response: { creatives: [{ id, name, thumbnailUrl, status, objectType }] }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { MetaApiError } from "@/lib/meta/client";
import { createAdCreative } from "@/server/services/creatives/create";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const accountIdParam = url.searchParams.get("accountId");
  if (!accountIdParam) {
    return NextResponse.json(
      { error: "accountId query param is required" },
      { status: 400 },
    );
  }
  const metaAdAccountId = accountIdParam.startsWith("act_")
    ? accountIdParam
    : `act_${accountIdParam}`;

  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId, selectedForSync: true },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Ad account not found or not selected for sync" },
      { status: 404 },
    );
  }

  const creatives = await prisma.adCreative.findMany({
    where: { adAccountId: account.id },
    select: {
      metaCreativeId: true,
      name: true,
      title: true,
      thumbnailUrl: true,
      status: true,
      objectType: true,
    },
    orderBy: { syncedAt: "desc" },
    take: 500,
  });

  return NextResponse.json({
    creatives: creatives.map((c) => ({
      id: c.metaCreativeId,
      name: c.name ?? c.title ?? "Untitled creative",
      thumbnailUrl: c.thumbnailUrl,
      status: c.status,
      objectType: c.objectType,
    })),
  });
}

/**
 * POST /api/creatives — create a standalone ad creative.
 *
 * Body:
 *   {
 *     metaAdAccountId, pageId, imageHash, linkUrl, callToActionType,
 *     message?, headline?, description?, name?, instagramActorId?
 *   }
 */
interface PostBody {
  metaAdAccountId?: unknown;
  name?: unknown;
  pageId?: unknown;
  imageHash?: unknown;
  message?: unknown;
  headline?: unknown;
  description?: unknown;
  linkUrl?: unknown;
  callToActionType?: unknown;
  instagramActorId?: unknown;
}

export async function POST(req: Request) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  if (!str(body.metaAdAccountId)?.trim()) {
    return NextResponse.json(
      { error: "metaAdAccountId is required" },
      { status: 400 },
    );
  }
  if (!str(body.pageId)?.trim()) {
    return NextResponse.json({ error: "pageId is required" }, { status: 400 });
  }
  if (!str(body.imageHash)?.trim()) {
    return NextResponse.json(
      { error: "imageHash is required" },
      { status: 400 },
    );
  }
  if (!str(body.linkUrl)?.trim()) {
    return NextResponse.json({ error: "linkUrl is required" }, { status: 400 });
  }
  if (!str(body.callToActionType)?.trim()) {
    return NextResponse.json(
      { error: "callToActionType is required" },
      { status: 400 },
    );
  }

  try {
    const result = await createAdCreative({
      metaAdAccountId: str(body.metaAdAccountId) as string,
      name: str(body.name),
      pageId: str(body.pageId) as string,
      imageHash: str(body.imageHash) as string,
      message: str(body.message) ?? "",
      headline: str(body.headline),
      description: str(body.description),
      linkUrl: str(body.linkUrl) as string,
      callToActionType: str(body.callToActionType) as string,
      instagramActorId: str(body.instagramActorId),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("create creative error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
