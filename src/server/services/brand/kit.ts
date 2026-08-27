/**
 * Brand kit — a colour palette, identity copy, one logo and several style
 * references. Feeds prompt assembly for the Ad Studio image generator
 * (see src/server/services/ai/studio-prompt.ts).
 *
 * Two scopes, distinguished by businessId:
 *
 *   businessId === null   the workspace's own kit — the operator's brand,
 *                         edited with "All clients" selected. Exactly one
 *                         exists, enforced by a partial unique index.
 *   businessId === "..."  a client's kit, scoped to their MetaBusiness.
 *
 * Nothing inherits. A client with no kit gets an empty one, never the
 * workspace's — each client owns their brand outright, which is also what
 * keeps the workspace kit private once clients get their own logins: a
 * client session scopes to its own businessId and can never address the
 * NULL row.
 *
 * A missing kit is a normal state, not an error: the studio still works
 * without one (the brand fragments in buildStudioPrompt are omitted).
 *
 * Assets live in the same private `meta-assets` bucket as everything else
 * under src/lib/storage/assets.ts, at `brand/<scope>/<assetId>` where
 * scope is the businessId or WORKSPACE_SCOPE. Rendered via
 * /api/media/<storagePath>, never a raw URL column (there isn't one here;
 * storagePath is all this table has).
 */

import { randomUUID } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { assetPath, storeBytes, storageClient, ASSET_BUCKET } from "@/lib/storage/assets";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_PALETTE_ENTRIES = 6;
const MAX_IDENTITY_LENGTH = 200;

/**
 * Path segment for the workspace kit's assets. Leading underscore because
 * a MetaBusiness id is a cuid and can never collide with it.
 */
const WORKSPACE_SCOPE = "_workspace";

/**
 * null is the workspace kit; a string is that client's kit. Every function
 * here takes this rather than a bare string, so a caller cannot silently
 * lose the distinction.
 */
export type KitScope = string | null;

/**
 * Thrown for input the operator can actually fix — a malformed hex colour,
 * too many palette entries, an over-long tagline. Routes map this to a 400
 * and show its message; anything else is an unexpected failure and becomes
 * a generic 500. A marker class rather than string-matching the message,
 * so adding a new validation rule cannot silently start returning 500s.
 */
export class BrandKitValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandKitValidationError";
  }
}

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
  brandName: string | null;
  tagline: string | null;
  avoidNotes: string | null;
  assets: BrandKitAssetView[];
}

export interface BrandKitInput {
  palette: string[];
  themeNotes: string | null;
  brandName: string | null;
  tagline: string | null;
  avoidNotes: string | null;
}

function toView(kit: {
  palette: string[];
  themeNotes: string | null;
  brandName: string | null;
  tagline: string | null;
  avoidNotes: string | null;
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
    brandName: kit.brandName,
    tagline: kit.tagline,
    avoidNotes: kit.avoidNotes,
    assets: kit.assets.map((a) => ({
      id: a.id,
      kind: a.kind as BrandAssetKind,
      url: `/api/media/${a.storagePath}`,
      label: a.label,
    })),
  };
}

/** Returns null when the scope has no kit yet — that is a normal state. */
export async function getBrandKit(
  scope: KitScope,
): Promise<BrandKitView | null> {
  // findFirst, not findUnique: Prisma rejects null in a unique `where`,
  // and businessId is nullable now. The unique constraint plus the
  // workspace partial index still guarantee at most one match either way.
  const kit = await prisma.brandKit.findFirst({
    where: { businessId: scope },
    include: { assets: { orderBy: { createdAt: "asc" } } },
  });
  if (!kit) return null;
  return toView(kit);
}

/**
 * Finds the scope's kit or creates an empty one. Used by both save paths,
 * so the operator never has to "create" a kit explicitly — editing it or
 * uploading to it IS creating it.
 *
 * The catch covers two saves racing to create the same kit: the loser of
 * the unique-constraint race re-reads the winner's row rather than
 * surfacing a constraint error the operator can do nothing about.
 */
async function findOrCreateKit(scope: KitScope): Promise<{ id: string }> {
  const existing = await prisma.brandKit.findFirst({
    where: { businessId: scope },
    select: { id: true },
  });
  if (existing) return existing;

  try {
    return await prisma.brandKit.create({
      data: { businessId: scope, palette: [] },
      select: { id: true },
    });
  } catch (err) {
    const raced = await prisma.brandKit.findFirst({
      where: { businessId: scope },
      select: { id: true },
    });
    if (raced) return raced;
    throw err;
  }
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
      throw new BrandKitValidationError(
        `Invalid palette colour: "${raw}" (expected #RRGGBB)`,
      );
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  if (out.length > MAX_PALETTE_ENTRIES) {
    throw new BrandKitValidationError(
      `Palette is limited to ${MAX_PALETTE_ENTRIES} colours`,
    );
  }
  return out;
}

/**
 * Identity copy is trimmed, blanked to null when empty, and length-capped.
 * It is rendered into an image prompt verbatim, so an accidental paste of
 * a whole paragraph would quietly dominate every generation.
 */
function normalizeIdentity(value: string | null, field: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_IDENTITY_LENGTH) {
    throw new BrandKitValidationError(
      `${field} is limited to ${MAX_IDENTITY_LENGTH} characters`,
    );
  }
  return trimmed;
}

/** Creates the kit on first save — the user never has to "create" one explicitly. */
export async function upsertBrandKit(
  scope: KitScope,
  input: BrandKitInput,
): Promise<BrandKitView> {
  const data = {
    palette: normalizePalette(input.palette),
    themeNotes: input.themeNotes?.trim() || null,
    brandName: normalizeIdentity(input.brandName, "Brand name"),
    tagline: normalizeIdentity(input.tagline, "Tagline"),
    avoidNotes: normalizeIdentity(input.avoidNotes, "Do-not list"),
  };

  // Validation runs before anything is written, so a rejected palette or
  // an over-long tagline cannot leave a half-created empty kit behind.
  const { id } = await findOrCreateKit(scope);
  const kit = await prisma.brandKit.update({
    where: { id },
    data,
    include: { assets: { orderBy: { createdAt: "asc" } } },
  });
  return toView(kit);
}

/**
 * Adds a logo or reference asset, storing bytes at
 * brand/<scope>/<assetId>. A LOGO replaces any existing logo — the old
 * row and its bucket object are deleted once the new one is in place,
 * since the logo is a singleton by convention and leaving the old object
 * behind would quietly fill the bucket.
 *
 * Creates the kit if the scope doesn't have one yet, same as
 * upsertBrandKit — uploading an asset is itself "starting" a kit.
 */
export async function addBrandAsset(
  scope: KitScope,
  kind: BrandAssetKind,
  bytes: Uint8Array,
  contentType: string,
  label?: string | null,
): Promise<BrandKitAssetView> {
  const kit = await findOrCreateKit(scope);

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
  // logo and leaves the kit with none, surfaced to the caller as a bare
  // 500. This order guarantees a failed store leaves the kit exactly as
  // it was.
  const assetId = randomUUID();
  const path = assetPath("brand", scope ?? WORKSPACE_SCOPE, assetId);
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
 * belongs to the given scope's kit before deleting anything; an id from
 * the client is never trusted on its own. Scoping on businessId: null
 * matters here too — a client id must not reach a workspace asset.
 */
export async function removeBrandAsset(
  scope: KitScope,
  assetId: string,
): Promise<void> {
  const asset = await prisma.brandAsset.findFirst({
    where: { id: assetId, brandKit: { is: { businessId: scope } } },
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
