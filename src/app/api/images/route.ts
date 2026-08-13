/**
 * GET /api/images?accountId=<act_... | ...>
 *
 * Returns the synced AdImages for one account, used by the Create Creative
 * image picker. Reads from our local mirror (populated by the images sync) —
 * fast, no Meta round-trip. The `hash` is what a creative references.
 *
 * Response: { images: [{ hash, url, name, width, height }] }
 *
 * POST /api/images (multipart/form-data)
 *   accountId — act_-prefixed (or bare) ad account id
 *   image     — File to upload to /act_{id}/adimages
 *
 * Uploads a standalone image into the account's library + mirrors it locally.
 * Response: { hash, url }
 */

import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { MetaApiError } from "@/lib/meta/client";
import { uploadLibraryImage } from "@/server/services/images/upload";
import { describeAccountImages } from "@/server/services/ai/analyze-media";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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

  const images = await prisma.adImage.findMany({
    where: { adAccountId: account.id },
    select: {
      metaImageHash: true,
      url: true,
      name: true,
      width: true,
      height: true,
    },
    orderBy: { syncedAt: "desc" },
    take: 500,
  });

  return NextResponse.json({
    images: images.map((i) => ({
      hash: i.metaImageHash,
      url: i.url,
      name: i.name,
      width: i.width,
      height: i.height,
    })),
  });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data body" },
      { status: 400 },
    );
  }

  const accountId = form.get("accountId");
  if (typeof accountId !== "string" || !accountId.trim()) {
    return NextResponse.json(
      { error: "accountId is required" },
      { status: 400 },
    );
  }

  const imageField = form.get("image");
  if (!(imageField instanceof Blob) || imageField.size === 0) {
    return NextResponse.json(
      { error: "image file is required" },
      { status: 400 },
    );
  }
  if (imageField.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      {
        error: `image too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB)`,
      },
      { status: 413 },
    );
  }
  const imageFilename =
    imageField instanceof File && imageField.name
      ? imageField.name
      : "upload.jpg";

  try {
    const result = await uploadLibraryImage({
      metaAdAccountId: accountId.trim(),
      imageBlob: imageField,
      imageFilename,
    });

    // Describe the new image so the campaign copilot can reason about it
    // rather than choosing by filename. describeAccountImages skips anything
    // that already has a description, so this costs exactly one vision call
    // for the image just uploaded.
    //
    // In after() because a vision call takes seconds and the uploader is
    // waiting on a hash, not on analysis.
    after(async () => {
      try {
        const account = await prisma.metaAdAccount.findFirst({
          where: {
            metaAdAccountId: accountId.trim().startsWith("act_")
              ? accountId.trim()
              : `act_${accountId.trim()}`,
          },
          select: { id: true },
        });
        if (account) {
          await describeAccountImages(account.id, { includeUnreferenced: true });
        }
      } catch (e) {
        console.error(
          "[images/upload] description failed:",
          e instanceof Error ? e.message : e,
        );
      }
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("upload image error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
