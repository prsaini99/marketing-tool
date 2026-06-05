/**
 * AI-generated ad imagery — variants + surgical tweaks.
 *
 * Powered by OpenAI's `gpt-image-1`. We request `n` distinct images per
 * generate call (the model picks angles/styles on its own from the same
 * prompt). Output is base64 so the client can render variants immediately
 * without any temp-storage round-trip — when the user picks one, the
 * bytes are POSTed to the existing /api/images upload route which writes
 * them to Meta's ad-image library and returns the hash.
 *
 * The prompt is built around the strategist's brief — we don't try to
 * RAG-ground image generation today (vision-RAG over past creatives is a
 * Phase 2 idea; for now the brand-voice anchor is the brief itself).
 *
 * Square 1024×1024 is the default — close to Meta's 1080×1080 sweet spot
 * for Feed placements. Meta accepts 1024 fine.
 */

import OpenAI, { toFile } from "openai";

const apiKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: apiKey ?? "missing-key" });

const MODEL = "gpt-image-1";
// 1024×1024 = square; matches Meta's preferred 1:1 ratio.
// 1024×1536 = portrait, useful for Stories/Reels — future toggle.
const DEFAULT_SIZE = "1024x1024" as const;

// "low" / "medium" / "high" trade quality for cost — roughly ₹1.5 / ₹4 / ₹15
// per image at 1024². Low is the right default for brainstorming variants;
// strategists can crank up to medium/high for the final pick.
export type ImageQuality = "low" | "medium" | "high";
const DEFAULT_QUALITY: ImageQuality = "low";

// System frame — kept verbose on purpose. gpt-image-1 freestyles the
// composition unless explicitly told otherwise; this is the cost of one
// retry vs the cost of a few extra prompt tokens.
const SYSTEM_FRAME = `You are a senior creative director directing a professional photoshoot for a Meta Ads campaign. The image must look like an art-directed brand photograph a senior designer would approve and ship — NOT like a generic AI image. Treat the brief as a creative brief, not a literal prompt.

FRAMING (non-negotiable — failures here make the image unusable):
- The subject must be FULLY within the frame. No part of the body — head, face, hair, limbs, hands, fingers, feet — may be cut by the frame edges. Leave clean breathing room on all four sides.
- Keep all critical visual elements within the centre 80% of the frame. Meta crops the edges for some placements (Stories, Reels, side bars) — anything important near the edge will get destroyed.
- Pick ONE intentional framing and execute it cleanly: head-and-shoulders, half-body, three-quarter, full body, or product close-up. Don't half-commit between two.
- Eye level should be deliberate (eye-level for connection, slight high-angle for product, slight low for aspirational). Never an awkward in-between.

COMPOSITION:
- Rule-of-thirds by default — subject placed off-centre on a power line — unless the brief specifically calls for dead-centre symmetry.
- Clear focal hierarchy: one subject the eye lands on first, supporting elements clearly behind / subordinate.
- Background must be intentional and brand-appropriate. NOT a generic blurred bokeh wall unless the brief explicitly asks for one.
- Confident use of negative space. Don't fill every pixel.

PHOTOGRAPHY DIRECTION (this is what separates designer-grade from AI-grade):
- Treat the brief as a real photoshoot. Imagine a specific lens (85mm prime for portraits, 35mm for lifestyle, 50mm for product) and shallow but realistic depth of field — not the cartoonish fake-blur AI loves to default to.
- Natural, motivated lighting — a clear key light direction with believable fill. NEVER the flat, frontal, even softbox-into-the-face look that immediately reads "AI image".
- Realistic skin texture, visible pores, individual hair strands, real fabric drape and wrinkles, real shadows under chins / behind objects. Plastic skin and overly-smooth faces are an instant fail.
- Subtle editorial color grading — a coherent palette, not the over-saturated hyper-contrasted "AI default" look.
- A touch of film grain / texture is welcome when it fits the brand.

ANTI-AI-TROPE RULES (if you do any of these, the image is unusable):
- No symmetrical fake-perfect faces. Real humans are asymmetric. Vary the expression too — don't default to "smiling at camera".
- No identical repeating bokeh circles. No "festival of perfectly round lights" unless the brief explicitly asks for it.
- No extra fingers, fused hands, floating limbs, melting jewellery, distorted text.
- No watermarks, logos, fake brand marks, fake captions, fake hashtags, fake web URLs.
- No on-image text unless the brief explicitly asks for it. Meta penalises text-heavy creatives.
- No generic stock-photo poses. No "lady-presenting-her-laptop", no "diverse-team-laughing-at-nothing".

OUTPUT FORMAT:
- 1:1 square, 1024×1024.
- Designer-grade. If you wouldn't put this on a brand's billboard or Instagram grid, regenerate mentally before committing.

The brief follows. Read it as a creative direction, then execute with the rules above.`;

function buildPrompt(brief: string, tweakInstruction?: string): string {
  const tweak = tweakInstruction?.trim()
    ? `\n\nIMPORTANT MODIFICATION FROM THE STRATEGIST: ${tweakInstruction.trim()}`
    : "";
  return `${SYSTEM_FRAME}\n\nCREATIVE BRIEF:\n${brief.trim()}${tweak}`;
}

export interface AdImageVariant {
  /** Base64-encoded PNG bytes (no data: prefix). */
  b64: string;
  mimeType: string;
}

export interface GenerateAdImageInput {
  brief: string;
  /** How many variants — clamped 1..4 (OpenAI n cap is 10 but cost adds up). */
  count?: number;
  /** "low" (default) / "medium" / "high". Bigger = sharper + costlier. */
  quality?: ImageQuality;
}

export async function generateAdImages(
  input: GenerateAdImageInput,
): Promise<{ variants: AdImageVariant[]; prompt: string }> {
  const brief = input.brief?.trim();
  if (!brief) throw new Error("brief is required");
  const count = Math.max(1, Math.min(4, input.count ?? 2));
  const quality = input.quality ?? DEFAULT_QUALITY;
  const prompt = buildPrompt(brief);

  const res = await openai.images.generate({
    model: MODEL,
    prompt,
    n: count,
    size: DEFAULT_SIZE,
    quality,
  });

  const variants: AdImageVariant[] = (res.data ?? [])
    .filter((d): d is { b64_json: string } => Boolean(d.b64_json))
    .map((d) => ({ b64: d.b64_json, mimeType: "image/png" }));

  if (variants.length === 0) {
    throw new Error("OpenAI returned no image data");
  }
  return { variants, prompt };
}

export interface TweakAdImageInput {
  brief: string;
  instruction: string;
  /**
   * Base64 of the original image (no data: prefix). Required — without it
   * the "tweak" would actually be a full regenerate, losing the
   * composition the strategist liked.
   */
  originalB64: string;
  /** "low" (default) / "medium" / "high". Same scale as generate. */
  quality?: ImageQuality;
}

/**
 * Image-to-image edit via OpenAI's `images.edit()` endpoint. We hand it
 * the source image and a prompt that explicitly says "preserve everything
 * else"; gpt-image-1 then changes only what the instruction asks.
 *
 * No mask is sent — gpt-image-1 figures out which region to modify from
 * the instruction. This is the right behaviour for conceptual edits
 * ("make her smile", "warmer lighting"). For spatial edits ("remove the
 * prop on the right"), a hand-drawn mask would be better, but that's a
 * UX rabbit hole we'll postpone.
 */
export async function tweakAdImage(
  input: TweakAdImageInput,
): Promise<{ variant: AdImageVariant; prompt: string }> {
  const brief = input.brief?.trim();
  const instruction = input.instruction?.trim();
  const originalB64 = input.originalB64?.trim();
  if (!instruction) throw new Error("instruction is required");
  if (!originalB64) {
    throw new Error("originalB64 is required (the source image to edit)");
  }

  // OpenAI's edit endpoint wants a File-like; toFile wraps a Buffer.
  const buffer = Buffer.from(originalB64, "base64");
  const sourceFile = await toFile(buffer, "source.png", {
    type: "image/png",
  });

  // Prompt is framed as "edit this image" so the model treats the input
  // as the canonical composition and applies only the requested change.
  // Framing rules are restated so the edit doesn't accidentally crop the
  // subject — a common failure mode for image-to-image edits.
  const prompt = `You are a senior retoucher editing a Meta ad creative. Apply this change precisely and ONLY this change: ${instruction}.

Preserve EVERYTHING ELSE from the original — same subject identity, same face, same composition and pose framing, same clothing, same lighting style, same background, same color palette. Do not invent new elements. Do not re-pose the subject. Do not re-frame the shot.

FRAMING (must hold after the edit):
- The subject must still be fully within the frame. Do not crop the head, hands, or feet at the edges.
- Keep critical elements within the centre 80% of the frame.
- Maintain the original aspect ratio and zoom level.

QUALITY:
- Realistic skin / hair / fabric texture. No plastic-skin smoothing.
- No new watermarks, logos, captions, or on-image text.
- No extra fingers, fused hands, melting accessories.${
    brief ? `\n\nOriginal creative brief for context: ${brief}` : ""
  }`;

  const res = await openai.images.edit({
    model: MODEL,
    image: sourceFile,
    prompt,
    size: DEFAULT_SIZE,
    quality: input.quality ?? DEFAULT_QUALITY,
  });

  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return { variant: { b64, mimeType: "image/png" }, prompt };
}
