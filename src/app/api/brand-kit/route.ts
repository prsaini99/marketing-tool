/**
 * GET /api/brand-kit           → the workspace's own kit
 * GET /api/brand-kit?client=X  → that client's kit
 *
 * Returns null when the scope has no kit yet — a missing kit is a normal
 * state, not an error.
 *
 * PUT /api/brand-kit
 *   body: { businessId: string | null, palette, themeNotes,
 *           brandName, tagline, avoidNotes }
 *
 * A null (or absent) businessId addresses the workspace kit — the
 * operator's own brand, the one edited with "All clients" selected.
 * Creates the kit on first save or updates it. Session-guarded like every
 * other /api/* route — see src/middleware.ts.
 */

import { NextResponse } from "next/server";
import {
  BrandKitValidationError,
  getBrandKit,
  upsertBrandKit,
  type KitScope,
} from "@/server/services/brand/kit";
import { prisma } from "@/lib/db/prisma";

/**
 * An absent or empty `client` param means the workspace kit. Empty string
 * is folded into null deliberately: `?client=` is what a URL builder
 * produces for "no client selected", and treating it as a client id would
 * send it to Prisma as a lookup that can never match.
 */
function scopeFromParam(value: string | null): KitScope {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Confirms a client scope names a real MetaBusiness before it reaches
 * Prisma through upsertBrandKit — otherwise a bad id trips BrandKit's
 * foreign key constraint, and Prisma's raw error text ("Foreign key
 * constraint failed on the field: …") leaks straight to the client as a
 * 400, mislabelling an invalid-input case with an opaque database detail.
 * The workspace scope has no row to check.
 */
async function scopeExists(scope: KitScope): Promise<boolean> {
  if (scope === null) return true;
  const business = await prisma.metaBusiness.findUnique({
    where: { id: scope },
    select: { id: true },
  });
  return Boolean(business);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const scope = scopeFromParam(url.searchParams.get("client"));
  const kit = await getBrandKit(scope);
  return NextResponse.json(kit);
}

export async function PUT(req: Request) {
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

  const { businessId, palette, themeNotes, brandName, tagline, avoidNotes } =
    body as Record<string, unknown>;

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
  if (!Array.isArray(palette) || !palette.every((p) => typeof p === "string")) {
    return NextResponse.json(
      { error: "palette must be an array of strings" },
      { status: 400 },
    );
  }

  const optionalText: Array<[string, unknown]> = [
    ["themeNotes", themeNotes],
    ["brandName", brandName],
    ["tagline", tagline],
    ["avoidNotes", avoidNotes],
  ];
  for (const [field, value] of optionalText) {
    if (value !== null && value !== undefined && typeof value !== "string") {
      return NextResponse.json(
        { error: `${field} must be a string or null` },
        { status: 400 },
      );
    }
  }

  const scope = scopeFromParam(typeof businessId === "string" ? businessId : null);
  if (!(await scopeExists(scope))) {
    return NextResponse.json(
      { error: "No business found for that businessId" },
      { status: 400 },
    );
  }

  try {
    const kit = await upsertBrandKit(scope, {
      palette,
      themeNotes: (themeNotes as string | null | undefined) ?? null,
      brandName: (brandName as string | null | undefined) ?? null,
      tagline: (tagline as string | null | undefined) ?? null,
      avoidNotes: (avoidNotes as string | null | undefined) ?? null,
    });
    return NextResponse.json(kit);
  } catch (err) {
    // BrandKitValidationError is input the operator can fix (a bad hex
    // colour, too many entries, an over-long tagline) — safe to show, and
    // genuinely a 400. Anything else is unexpected server failure: it must
    // not be mislabelled as the client's fault, nor leak raw internals.
    if (err instanceof BrandKitValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("brand-kit PUT error:", err);
    return NextResponse.json(
      { error: "Failed to save brand kit" },
      { status: 500 },
    );
  }
}
