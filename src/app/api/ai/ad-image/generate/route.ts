/**
 * POST /api/ai/ad-image/generate
 *
 * Generate N image variants from a brief using OpenAI's gpt-image-1. Returns
 * base64-encoded PNGs so the client can render immediately; if the user picks
 * one, the bytes get POSTed to /api/images to land in Meta's library.
 *
 * Body: { brief, formatId?, count?, quality?, model?, references?, brand?, toggles? }
 * Returns: { variants: [{ b64, mimeType }], prompt, angle, copy, copyError,
 *            droppedSlots }
 *
 * When formatId is given, an empty brief is allowed (the one-click path):
 * the copy stage (ad-copy.ts) writes the on-image strings from the format's
 * default angle, the brand kit and the brief if any, count is forced to 1,
 * and the format's own layout replaces the built-in promotional frame.
 */

import { NextResponse } from "next/server";
import { generateAdImages } from "@/server/services/ai/generate-ad-image";
import { getFormat } from "@/server/services/ai/ad-formats";
import { writeAdCopy, type AdCopy } from "@/server/services/ai/ad-copy";
import {
  buildStudioPrompt,
  MAX_REFERENCES,
  type ReferenceRole,
  type StudioBrand,
  type StudioToggles,
} from "@/server/services/ai/studio-prompt";

// gpt-image-1 calls can take 15–40s for 3–4 variants at medium quality.
// Bump the default 10s ceiling so they don't get cut short.
export const maxDuration = 120;

const REFERENCE_ROLES: ReferenceRole[] = ["product", "proof", "style", "logo"];

/**
 * Which reference role actually satisfies a format's `needs`. The server is
 * the enforcement boundary: it previously accepted ANY role for any `needs`,
 * so a logo-only upload cleared a format that requires a real before/after.
 * "proof" formats are the ones the design says must never be synthesised.
 */
const NEEDS_ROLE: Record<"product" | "proof", ReferenceRole> = {
  product: "product",
  proof: "proof",
};

const NEEDS_REASON: Record<"product" | "proof", string> = {
  product: "a product photo, tagged Product",
  proof: "a real photo of the result, the customer or the founder, tagged Proof",
};
// Same allowlist enforced when the byte source is first accepted (brand-kit
// upload route, generate-ad-image.ts's toFile labelling) — an unrecognised
// mimeType here is dropped rather than trusted, not rejected outright,
// since `mimeType` is optional and older callers never send it.
const KNOWN_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function parseQuality(v: unknown): "low" | "medium" | "high" | undefined {
  return v === "low" || v === "medium" || v === "high" ? v : undefined;
}

function isReferenceRole(v: unknown): v is ReferenceRole {
  return typeof v === "string" && (REFERENCE_ROLES as string[]).includes(v);
}

/** Validates the shape of `references`; returns undefined if the field is absent. */
function parseReferences(
  v: unknown,
): Array<{ b64: string; role: ReferenceRole; mimeType?: string }> | undefined | "invalid" {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return "invalid";
  const out: Array<{ b64: string; role: ReferenceRole; mimeType?: string }> = [];
  for (const item of v) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).b64 !== "string" ||
      !(item as Record<string, unknown>).b64 ||
      !isReferenceRole((item as Record<string, unknown>).role)
    ) {
      return "invalid";
    }
    const rawMimeType = (item as Record<string, unknown>).mimeType;
    const mimeType =
      typeof rawMimeType === "string" && KNOWN_REFERENCE_MIME_TYPES.has(rawMimeType)
        ? rawMimeType
        : undefined;
    out.push({
      b64: (item as { b64: string }).b64,
      role: (item as { role: ReferenceRole }).role,
      ...(mimeType ? { mimeType } : {}),
    });
  }
  return out;
}

function parseBrand(v: unknown): StudioBrand | null | "invalid" {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object") return "invalid";
  const obj = v as Record<string, unknown>;
  if (!Array.isArray(obj.palette) || !obj.palette.every((c) => typeof c === "string")) {
    return "invalid";
  }
  for (const field of ["themeNotes", "brandName", "tagline", "avoidNotes"]) {
    const value = obj[field];
    if (value !== null && value !== undefined && typeof value !== "string") {
      return "invalid";
    }
  }
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    palette: obj.palette,
    themeNotes: str(obj.themeNotes),
    brandName: str(obj.brandName),
    tagline: str(obj.tagline),
    avoidNotes: str(obj.avoidNotes),
  };
}

function parseToggles(v: unknown): StudioToggles | "invalid" {
  if (v === undefined) {
    return {
      useColours: true,
      useTheme: true,
      useLogo: true,
      useIdentity: true,
      useAvoid: true,
    };
  }
  if (typeof v !== "object" || v === null) return "invalid";
  const obj = v as Record<string, unknown>;
  const flags = ["useColours", "useTheme", "useLogo", "useIdentity", "useAvoid"] as const;
  if (flags.some((f) => typeof obj[f] !== "boolean")) return "invalid";
  return {
    useColours: obj.useColours as boolean,
    useTheme: obj.useTheme as boolean,
    useLogo: obj.useLogo as boolean,
    useIdentity: obj.useIdentity as boolean,
    useAvoid: obj.useAvoid as boolean,
  };
}

export async function POST(req: Request) {
  let body: {
    brief?: unknown;
    formatId?: unknown;
    count?: unknown;
    quality?: unknown;
    model?: unknown;
    references?: unknown;
    brand?: unknown;
    toggles?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const formatId =
    typeof body.formatId === "string" && body.formatId.trim()
      ? body.formatId.trim()
      : undefined;
  const format = formatId ? getFormat(formatId) : null;
  if (formatId && !format) {
    return NextResponse.json(
      { error: `Unknown format "${formatId}"` },
      { status: 400 },
    );
  }

  // A format supplies its own default angle, so an empty brief is the
  // one-click path. Without a format, the brief is the only input — keep
  // the original whitespace-only rejection exactly as it was.
  if (typeof body.brief !== "string") {
    return NextResponse.json(
      { error: "brief is required" },
      { status: 400 },
    );
  }
  if (!format && !body.brief.trim()) {
    return NextResponse.json(
      { error: "brief is required" },
      { status: 400 },
    );
  }

  const count =
    typeof body.count === "number" && Number.isFinite(body.count)
      ? body.count
      : undefined;

  const model =
    typeof body.model === "string" && body.model.trim() ? body.model : undefined;

  const references = parseReferences(body.references);
  if (references === "invalid") {
    return NextResponse.json(
      { error: "references must be an array of { b64: string, role: 'product' | 'proof' | 'style' | 'logo' }" },
      { status: 400 },
    );
  }
  if (references && references.length > MAX_REFERENCES) {
    return NextResponse.json(
      { error: `references cannot exceed ${MAX_REFERENCES} images` },
      { status: 400 },
    );
  }

  // Role-aware, not merely "some reference was attached". A format that needs
  // real proof must have a reference the operator tagged Proof; a logo or a
  // style board does not stand in for a real before/after, and accepting one
  // is exactly the synthesised testimonial the design forbids.
  if (format && format.needs !== "none") {
    const required = NEEDS_ROLE[format.needs];
    if (!references?.some((r) => r.role === required)) {
      return NextResponse.json(
        {
          error: `The ${format.name} format needs a reference image — ${NEEDS_REASON[format.needs]}.`,
        },
        { status: 400 },
      );
    }
  }

  const brand = parseBrand(body.brand);
  if (brand === "invalid") {
    return NextResponse.json(
      { error: "brand must be { palette: string[], themeNotes: string | null }" },
      { status: 400 },
    );
  }

  const toggles = parseToggles(body.toggles);
  if (toggles === "invalid") {
    return NextResponse.json(
      { error: "toggles must be { useColours, useTheme, useLogo }: boolean" },
      { status: 400 },
    );
  }

  // Dedupe roles before prompt composition — buildStudioPrompt trusts its
  // caller and does not dedupe, so a client sending several references
  // with the same role (all within MAX_REFERENCES) would otherwise get
  // the same role instruction repeated once per duplicate. The references
  // array itself stays intact — every image is still sent to the model.
  const roles = references
    ? [...new Set(references.map((r) => r.role))]
    : [];

  let copy: AdCopy | null = null;
  let copyError: string | null = null;
  if (format) {
    try {
      copy = await writeAdCopy({ format, brief: body.brief, brand });
    } catch (err) {
      // A text-call hiccup must not cost the operator their click. Fall back
      // to the brief as written and say so; the image still gets made.
      console.error("ad-copy stage failed:", err);
      // Accurate on both paths: on the one-click path there is no brief to
      // fall back to, so saying "from your brief alone" was simply wrong.
      copyError = body.brief.trim()
        ? "Couldn't write the copy — generated from your brief alone, with no written headline."
        : "Couldn't write the copy — generated from the format and brand kit alone, with no written headline.";
    }
  }

  const brief = buildStudioPrompt({
    brief: body.brief.trim(),
    brand,
    toggles,
    roles,
    layout: format?.layout,
    copy: copy ?? undefined,
  });

  try {
    const result = await generateAdImages({
      brief,
      count: formatId ? 1 : count,
      quality: parseQuality(body.quality),
      model,
      references,
      promoFrame: !format,
    });
    return NextResponse.json({
      ...result,
      angle: copy?.angle ?? null,
      copy,
      copyError,
      // Slots the guard stripped because their figure was not in the inputs.
      // Surfaced so a figure-defined format (stat drop, offer stack) does not
      // come back silently missing its figure.
      droppedSlots: copy?.droppedSlots ?? [],
    });
  } catch (err) {
    console.error("ad-image generate error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
