/**
 * GET /api/brand-kit?client=<businessId>
 *
 * Returns the brand kit for one client (a MetaBusiness), or null when none
 * exists yet — a missing kit is a normal state, not an error.
 *
 * PUT /api/brand-kit
 *   body: { businessId, palette: string[], themeNotes: string | null }
 *
 * Creates the kit on first save or updates it. Session-guarded like every
 * other /api/* route — see src/middleware.ts.
 */

import { NextResponse } from "next/server";
import { getBrandKit, upsertBrandKit } from "@/server/services/brand/kit";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("client");
  if (!businessId) {
    return NextResponse.json(
      { error: "client query param is required" },
      { status: 400 },
    );
  }

  const kit = await getBrandKit(businessId);
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

  const { businessId, palette, themeNotes } = body as Record<string, unknown>;

  if (typeof businessId !== "string" || !businessId.trim()) {
    return NextResponse.json(
      { error: "businessId is required" },
      { status: 400 },
    );
  }
  if (!Array.isArray(palette) || !palette.every((p) => typeof p === "string")) {
    return NextResponse.json(
      { error: "palette must be an array of strings" },
      { status: 400 },
    );
  }
  if (themeNotes !== null && themeNotes !== undefined && typeof themeNotes !== "string") {
    return NextResponse.json(
      { error: "themeNotes must be a string or null" },
      { status: 400 },
    );
  }

  // Check the business exists BEFORE handing businessId to Prisma via
  // upsertBrandKit — otherwise a bad id trips BrandKit's foreign key
  // constraint, and Prisma's raw error text ("Foreign key constraint
  // failed on the field: …") would leak straight to the client as a 400,
  // mislabelling what's actually an invalid-input case with an opaque
  // database detail instead of a clear message.
  const business = await prisma.metaBusiness.findUnique({
    where: { id: businessId.trim() },
    select: { id: true },
  });
  if (!business) {
    return NextResponse.json(
      { error: "No business found for that businessId" },
      { status: 400 },
    );
  }

  try {
    const kit = await upsertBrandKit(businessId, {
      palette,
      themeNotes: themeNotes ?? null,
    });
    return NextResponse.json(kit);
  } catch (err) {
    // normalizePalette throws Error with a specific, safe-to-show message
    // for actual client input problems (bad hex colour, too many entries) —
    // that's still real client input validation, so it still maps to 400.
    // Anything else (a DB hiccup, storage error, etc.) is unexpected server
    // failure and must not be mislabelled as the client's fault, nor leak
    // raw internals — map it to a generic 500 instead.
    if (err instanceof Error && /palette/i.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("brand-kit PUT error:", err);
    return NextResponse.json(
      { error: "Failed to save brand kit" },
      { status: 500 },
    );
  }
}
