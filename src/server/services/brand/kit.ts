/**
 * Brand kit — per-client (per-MetaBusiness) colour palette, theme notes,
 * one logo and several style references. Feeds prompt assembly for the Ad
 * Studio image generator (see src/server/services/ai/studio-prompt.ts).
 *
 * A missing kit is a normal state, not an error: most clients won't have
 * bothered to set one up, and the studio still works without it (the
 * palette/theme fragments in buildStudioPrompt are simply omitted).
 *
 * Assets live in the same private `meta-assets` bucket as everything else
 * under src/lib/storage/assets.ts, at `brand/<businessId>/<assetId>` —
 * the "brand" AssetKind added in Task 1. Rendered via mediaUrl()/
 * /api/media/<storagePath>, never a raw URL column (there isn't one here;
 * storagePath is all this table has).
 */

import { randomUUID } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { assetPath, storeBytes, storageClient, ASSET_BUCKET } from "@/lib/storage/assets";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_PALETTE_ENTRIES = 6;

export type BrandAssetKind = "LOGO" | "REFERENCE";

export interface BrandKitAssetView {
  id: string;
  kind: BrandAssetKind;
  url: string;
  label: string | null;
}

export interface BrandKitView {
  palette: string[];
  themeNotes: string | null;
  assets: BrandKitAssetView[];
}

function toView(kit: {
  palette: string[];
  themeNotes: string | null;
  assets: Array<{
    id: string;
    kind: string;
    storagePath: string;
    label: string | null;
  }>;
}): BrandKitView {
  return {
    palette: kit.palette,
    themeNotes: kit.themeNotes,
    assets: kit.assets.map((a) => ({
      id: a.id,
      kind: a.kind as BrandAssetKind,
      url: `/api/media/${a.storagePath}`,
      label: a.label,
    })),
  };
}

/** Returns null when the business has no kit yet — that is a normal state. */
export async function getBrandKit(
  businessId: string,
): Promise<BrandKitView | null> {
  const kit = await prisma.brandKit.findUnique({
    where: { businessId },
    include: { assets: { orderBy: { createdAt: "asc" } } },
  });
  if (!kit) return null;
  return toView(kit);
}

/**
 * Validates and normalises palette entries: trimmed, must match
 * /^#[0-9a-fA-F]{6}$/, de-duplicated (case-insensitively, keeping first
 * occurrence), capped at six. Throws on anything that isn't a valid hex
 * colour rather than silently dropping it — junk here ends up pasted into
 * an image-generation prompt.
 */
function normalizePalette(palette: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of palette) {
    const trimmed = raw.trim();
    if (!HEX_COLOR.test(trimmed)) {
      throw new Error(`Invalid palette colour: "${raw}" (expected #RRGGBB)`);
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  if (out.length > MAX_PALETTE_ENTRIES) {
    throw new Error(`Palette is limited to ${MAX_PALETTE_ENTRIES} colours`);
  }
  return out;
}

/** Creates the kit on first save — the user never has to "create" one explicitly. */
export async function upsertBrandKit(
  businessId: string,
  input: { palette: string[]; themeNotes: string | null },
): Promise<BrandKitView> {
  const palette = normalizePalette(input.palette);
  const themeNotes = input.themeNotes?.trim() || null;

  const kit = await prisma.brandKit.upsert({
    where: { businessId },
    create: { businessId, palette, themeNotes },
    update: { palette, themeNotes },
    include: { assets: { orderBy: { createdAt: "asc" } } },
  });
  return toView(kit);
}

/**
 * Adds a logo or reference asset, storing bytes at
 * brand/<businessId>/<assetId>. A LOGO replaces any existing logo — the
 * old row and its bucket object are deleted first, since the logo is a
 * singleton by convention and leaving the old object behind would quietly
 * fill the bucket.
 *
 * Creates the kit if the business doesn't have one yet, same as
 * upsertBrandKit — uploading an asset is itself "starting" a kit.
 */
export async function addBrandAsset(
  businessId: string,
  kind: BrandAssetKind,
  bytes: Uint8Array,
  contentType: string,
  label?: string | null,
): Promise<BrandKitAssetView> {
  const kit = await prisma.brandKit.upsert({
    where: { businessId },
    create: { businessId, palette: [] },
    update: {},
  });

  let previousLogo: { id: string; storagePath: string } | null = null;
  if (kind === "LOGO") {
    previousLogo = await prisma.brandAsset.findFirst({
      where: { brandKitId: kit.id, kind: "LOGO" },
    });
  }

  // Store and persist the NEW asset first, and only remove the old logo
  // (row + bucket object) once the new one is durably in place. Doing it
  // in the opposite order — delete-then-store — means a storage failure
  // (bucket misconfigured, transient error, quota) destroys the working
  // logo and leaves the business with none, surfaced to the caller as a
  // bare 500. This order guarantees a failed store leaves the kit exactly
  // as it was.
  const assetId = randomUUID();
  const path = assetPath("brand", businessId, assetId);
  const stored = await storeBytes(path, bytes, contentType);
  if (!stored.ok) {
    // Nothing was written or changed yet — the previous logo, if any, is
    // untouched, and there is no orphan row or object to clean up.
    throw new Error(stored.error ?? "Failed to store asset");
  }

  let asset;
  try {
    asset = await prisma.brandAsset.create({
      data: {
        id: assetId,
        brandKitId: kit.id,
        kind,
        storagePath: path,
        contentType,
        label: label?.trim() || null,
      },
    });
  } catch (err) {
    // The bytes landed but the row didn't (e.g. a DB hiccup right after a
    // successful upload). Best-effort clean up the now-orphaned object so
    // a failure here doesn't leave junk in the bucket, then surface the
    // original error — the previous logo is still untouched either way.
    const sb = storageClient();
    if (sb) {
      await sb.storage
        .from(ASSET_BUCKET)
        .remove([path])
        .catch(() => {});
    }
    throw err;
  }

  if (kind === "LOGO" && previousLogo) {
    await deleteAssetRowAndObject(previousLogo.id, previousLogo.storagePath);
  }

  return {
    id: asset.id,
    kind: asset.kind as BrandAssetKind,
    url: `/api/media/${asset.storagePath}`,
    label: asset.label,
  };
}

/**
 * Removes an asset — row and bucket object both. Verifies the asset
 * belongs to the given businessId's kit before deleting anything; an id
 * from the client is never trusted on its own.
 */
export async function removeBrandAsset(
  businessId: string,
  assetId: string,
): Promise<void> {
  const asset = await prisma.brandAsset.findFirst({
    where: { id: assetId, brandKit: { businessId } },
  });
  if (!asset) {
    throw new Error("Asset not found");
  }
  await deleteAssetRowAndObject(asset.id, asset.storagePath);
}

async function deleteAssetRowAndObject(
  assetId: string,
  storagePath: string,
): Promise<void> {
  const sb = storageClient();
  if (sb) {
    const { error } = await sb.storage.from(ASSET_BUCKET).remove([storagePath]);
    // Storage failures here are logged, not thrown: an orphan bucket object
    // is a cleanup nuisance, but leaving the DB row behind (or failing the
    // whole delete) because the bucket call hiccupped would be worse for
    // the user — they asked to remove an asset from the kit.
    if (error) {
      console.error(
        `[brand-kit] failed to delete bucket object ${storagePath}:`,
        error.message,
      );
    }
  }
  await prisma.brandAsset.delete({ where: { id: assetId } });
}
