/**
 * POST /api/ads
 *
 * Accepts multipart/form-data so the image file rides with the text fields.
 * See src/server/services/ads/create.ts for the upload-then-create flow.
 *
 * Form fields:
 *   metaAdSetId        — parent ad set Meta id
 *   name               — ad name
 *   status             — "PAUSED" | "ACTIVE"
 *   pageId             — Facebook Page id
 *   instagramActorId   — optional Instagram identity override
 *   link               — destination URL
 *   message            — primary text (the body copy)
 *   headline           — short headline under the media
 *   description        — optional small text under the headline
 *   callToAction       — Meta CTA enum (e.g. "SHOP_NOW")
 *   image              — File: the image to upload to Meta /adimages
 *
 * Reasonable file limit enforced here (10 MB) — beyond that Meta will reject
 * anyway and the upload wastes bandwidth.
 */

import { NextResponse } from "next/server";
import { createAd } from "@/server/services/ads/create";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const ALLOWED_CTA = new Set([
  "SHOP_NOW",
  "LEARN_MORE",
  "SIGN_UP",
  "SUBSCRIBE",
  "DOWNLOAD",
  "GET_QUOTE",
  "CONTACT_US",
  "APPLY_NOW",
  "BOOK_TRAVEL",
  "WATCH_MORE",
  "ORDER_NOW",
  "GET_OFFER",
  "SEND_MESSAGE",
  "NO_BUTTON",
]);

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

  function getString(key: string): string {
    const v = form.get(key);
    return typeof v === "string" ? v : "";
  }

  const metaAdSetId = getString("metaAdSetId").trim();
  if (!metaAdSetId) {
    return NextResponse.json(
      { error: "metaAdSetId is required" },
      { status: 400 },
    );
  }
  const name = getString("name").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const status = getString("status");
  if (status !== "PAUSED" && status !== "ACTIVE") {
    return NextResponse.json(
      { error: "status must be 'PAUSED' or 'ACTIVE'" },
      { status: 400 },
    );
  }
  const pageId = getString("pageId").trim();
  if (!pageId) {
    return NextResponse.json(
      { error: "pageId is required" },
      { status: 400 },
    );
  }
  const link = getString("link").trim();
  if (!link) {
    return NextResponse.json({ error: "link is required" }, { status: 400 });
  }
  const message = getString("message").trim();
  if (!message) {
    return NextResponse.json(
      { error: "message (primary text) is required" },
      { status: 400 },
    );
  }
  const headline = getString("headline").trim();
  if (!headline) {
    return NextResponse.json(
      { error: "headline is required" },
      { status: 400 },
    );
  }
  const callToAction = getString("callToAction").trim();
  if (!ALLOWED_CTA.has(callToAction)) {
    return NextResponse.json(
      {
        error: `callToAction must be one of: ${Array.from(ALLOWED_CTA).join(", ")}`,
      },
      { status: 400 },
    );
  }
  const description = getString("description").trim() || undefined;
  const instagramActorId =
    getString("instagramActorId").trim() || undefined;

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
    const result = await createAd({
      metaAdSetId,
      name,
      status: status as "PAUSED" | "ACTIVE",
      pageId,
      instagramActorId,
      link,
      message,
      headline,
      description,
      callToAction,
      imageBlob: imageField,
      imageFilename,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("create ad error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
