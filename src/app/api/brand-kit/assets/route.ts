/**
 * POST /api/brand-kit/assets (multipart/form-data)
 *   businessId — a client id, or omitted/empty for the workspace kit
 *   kind       — "LOGO" | "REFERENCE"
 *   file       — image file, <= 5 MB
 *   label      — optional
 *
 * Follows the multipart pattern in src/app/api/images/route.ts. A LOGO
 * upload replaces any existing logo (handled in the service).
 *
 * DELETE /api/brand-kit/assets
 *   body: { businessId: string | null, assetId }
 *
 * Removes one asset (row + bucket object). The service verifies the asset
 * belongs to that scope before deleting anything — a client id must not
 * reach a workspace asset, and vice versa.
 */

import { NextResponse } from "next/server";
import {
  addBrandAsset,
  removeBrandAsset,
  type KitScope,
} from "@/server/services/brand/kit";

const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const VALID_KINDS = new Set(["LOGO", "REFERENCE"]);
// Explicit allowlist, not `startsWith("image/")`. contentType is
// client-controlled, stored verbatim on BrandAsset, and echoed back
// verbatim as the response content-type by /api/media/<path> — so
// "image/svg+xml" would previously have let an operator upload an SVG
// that executes script when opened directly from our own origin, with
// the session cookie present. Every prior byte in this bucket came from
// Meta; brand-kit assets are the first operator-supplied-file path, so
// the old "any image/* is fine" assumption no longer holds.
const ALLOWED_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * An absent or empty businessId addresses the workspace kit — the
 * operator's own brand, edited with "All clients" selected. Empty string
 * folds to null because that is what a form field left blank sends.
 */
function scopeFrom(value: unknown): KitScope {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

  const scope = scopeFrom(form.get("businessId"));

  const kind = form.get("kind");
  if (typeof kind !== "string" || !VALID_KINDS.has(kind)) {
    return NextResponse.json(
      { error: 'kind must be "LOGO" or "REFERENCE"' },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json(
      { error: "file is required" },
      { status: 400 },
    );
  }
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json(
      {
        error: `file too large (max ${Math.round(MAX_ASSET_BYTES / 1024 / 1024)} MB)`,
      },
      { status: 400 },
    );
  }
  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    return NextResponse.json(
      {
        error: `unsupported content type "${file.type || "unknown"}" — expected one of: ${[...ALLOWED_CONTENT_TYPES].join(", ")}`,
      },
      { status: 400 },
    );
  }

  const labelField = form.get("label");
  const label = typeof labelField === "string" ? labelField : null;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset = await addBrandAsset(
      scope,
      kind as "LOGO" | "REFERENCE",
      bytes,
      file.type,
      label,
    );
    return NextResponse.json(asset);
  } catch (err) {
    console.error("brand-kit asset upload error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to upload asset" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON body" },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Expected a JSON object body" },
      { status: 400 },
    );
  }

  const { businessId, assetId } = body as Record<string, unknown>;
  if (
    businessId !== null &&
    businessId !== undefined &&
    typeof businessId !== "string"
  ) {
    return NextResponse.json(
      { error: "businessId must be a string or null" },
      { status: 400 },
    );
  }
  if (typeof assetId !== "string" || !assetId.trim()) {
    return NextResponse.json(
      { error: "assetId is required" },
      { status: 400 },
    );
  }

  try {
    await removeBrandAsset(scopeFrom(businessId), assetId.trim());
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to remove asset" },
      { status: 404 },
    );
  }
}
