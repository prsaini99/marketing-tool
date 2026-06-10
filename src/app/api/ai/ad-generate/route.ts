/**
 * POST /api/ai/ad-generate
 *
 * Combined "AI Studio" endpoint — one user click in the New Ad modal kicks
 * off copy + image generation in parallel from a single brief. The wire
 * shape is one request / one response, but copy and image are
 * fundamentally different model families (gpt-4o-mini vs gpt-image-1),
 * so under the hood we fan out to the two existing services and join the
 * results before responding.
 *
 * Body: {
 *   accountId: string,         // Meta ad account id (with or without act_ prefix)
 *   brief: string,             // shared creative brief
 *   count: number,             // matched variant count for both (1–4)
 *   generateCopy: boolean,     // toggle — true if the user wants copy variants
 *   generateImage: boolean,    // toggle — true if the user wants image variants
 *   imageQuality?: "low"|"medium"|"high",
 * }
 *
 * Returns: {
 *   copy?:  { variants, groundedIn },   // present iff generateCopy was true
 *   image?: { variants, prompt },       // present iff generateImage was true
 * }
 *
 * Per-side failures DON'T fail the whole call — a copy success + image
 * failure still ships the copy and surfaces an `imageError` field. The UI
 * is built to show partial results so the strategist isn't blocked.
 */

import { NextResponse } from "next/server";
import { generateAdCopy } from "@/server/services/ai/generate-ad-copy";
import { generateAdImages } from "@/server/services/ai/generate-ad-image";

// Image generation alone can take 30–40s for 3–4 variants. Copy is sub-10s.
// Bound by image side.
export const maxDuration = 120;

function parseQuality(v: unknown): "low" | "medium" | "high" | undefined {
  return v === "low" || v === "medium" || v === "high" ? v : undefined;
}

export async function POST(req: Request) {
  let body: {
    accountId?: unknown;
    brief?: unknown;
    count?: unknown;
    generateCopy?: unknown;
    generateImage?: unknown;
    imageQuality?: unknown;
    productReferenceB64?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.accountId !== "string" || !body.accountId.trim()) {
    return NextResponse.json(
      { error: "accountId is required" },
      { status: 400 },
    );
  }
  if (typeof body.brief !== "string" || !body.brief.trim()) {
    return NextResponse.json(
      { error: "brief is required" },
      { status: 400 },
    );
  }

  const wantCopy = body.generateCopy === true;
  const wantImage = body.generateImage === true;
  if (!wantCopy && !wantImage) {
    return NextResponse.json(
      { error: "At least one of generateCopy or generateImage must be true" },
      { status: 400 },
    );
  }

  const count =
    typeof body.count === "number" && Number.isFinite(body.count)
      ? Math.max(1, Math.min(4, Math.round(body.count)))
      : 3;

  const accountId = body.accountId.trim();
  const brief = body.brief.trim();
  const imageQuality = parseQuality(body.imageQuality);
  // Strip a `data:` prefix if the client sent one — the OpenAI SDK wants
  // raw base64 bytes. Empty string after trimming counts as "not provided".
  const rawProductRef =
    typeof body.productReferenceB64 === "string"
      ? body.productReferenceB64.replace(/^data:image\/[a-z]+;base64,/i, "").trim()
      : "";
  const productReferenceB64 = rawProductRef.length > 0 ? rawProductRef : undefined;

  // Settle individually — we want partial success when one side errors.
  const [copyRes, imageRes] = await Promise.allSettled([
    wantCopy
      ? generateAdCopy({ metaAdAccountId: accountId, brief, count })
      : Promise.resolve(null),
    wantImage
      ? generateAdImages({
          brief,
          count,
          quality: imageQuality,
          productReferenceB64,
        })
      : Promise.resolve(null),
  ]);

  const out: Record<string, unknown> = {};

  if (wantCopy) {
    if (copyRes.status === "fulfilled" && copyRes.value) {
      out.copy = copyRes.value;
    } else if (copyRes.status === "rejected") {
      console.error("ad-generate copy side failed:", copyRes.reason);
      out.copyError =
        copyRes.reason instanceof Error
          ? copyRes.reason.message
          : "Copy generation failed";
    }
  }

  if (wantImage) {
    if (imageRes.status === "fulfilled" && imageRes.value) {
      out.image = imageRes.value;
    } else if (imageRes.status === "rejected") {
      console.error("ad-generate image side failed:", imageRes.reason);
      out.imageError =
        imageRes.reason instanceof Error
          ? imageRes.reason.message
          : "Image generation failed";
    }
  }

  // If both sides errored, surface a top-level 500 so the client treats
  // it as a generation failure rather than a partial-result screen.
  if (
    (wantCopy && !out.copy && out.copyError) &&
    (wantImage && !out.image && out.imageError)
  ) {
    return NextResponse.json(
      {
        error: `Both sides failed: ${out.copyError as string}; ${out.imageError as string}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(out);
}
