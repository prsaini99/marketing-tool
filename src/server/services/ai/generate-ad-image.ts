/**
 * AI-generated ad imagery — variants + surgical tweaks.
 *
 * Powered by OpenAI's GPT Image models (gpt-image-2 / "Images 2.0" by
 * default — the same family behind the ChatGPT app; configurable via
 * OPENAI_IMAGE_MODEL). Two simple paths:
 *
 *   1. No product reference → `images.generate` from the brief alone.
 *      gpt-image-1 invents the subject from text.
 *   2. With product reference → `images.edit` in freestyle mode (no
 *      mask). The strategist's photo is handed to the model as
 *      creative reference; the model designs a complete, finished ad
 *      creative around what it sees — same product character, same
 *      vibe, but the model has full creative freedom on framing,
 *      pose, layout, props, lighting, decorative elements.
 *
 * Both paths produce FINISHED, READY-TO-SHIP PROMOTIONAL CREATIVES with
 * the offer typography baked in — headline ("DIWALI OFFER"), focal
 * discount figure ("FLAT 50% OFF"), a short tagline, and a "SHOP NOW"
 * button — all designed directly into the image, the way ChatGPT /
 * AdCreative-style tools do it. The strategist gives a one-line brief
 * ("Diwali saree sale, 50% off") + a product photo and gets a creative
 * they can publish to Meta as-is. (We previously kept text OFF the image
 * and relied on Meta's separate headline/primary-text fields; that mode
 * is retired — strategists wanted the all-in-one designed creative.)
 *
 * NOTE ON QUALITY: legible baked-in typography needs detail, so the
 * default quality is "medium" — at "low" the model's text comes out
 * mushy / misspelled. Strategists can drop to "low" for quick text-free-
 * ish concepting or push to "high" for the final pick.
 *
 * We tried a composite pipeline that pixel-faithfully preserved the
 * product (cutout → mask → background-only gen → sharp composite). It
 * worked — saree pixels were identical — but the resulting creatives
 * looked like cut-and-paste collages, not designed ads. Real ad
 * creative tools (ChatGPT, Midjourney, Firefly, Pebbly) all freestyle.
 * For Meta ads the visual impact of a stunning designed creative
 * drives way more clicks than a sterile pixel-faithful composite, and
 * the customer sees the actual product on the landing page anyway, so
 * "recognisably the same product" is the right bar — not "every
 * thread identical".
 *
 * Output is base64 so the client can render variants immediately
 * without any temp-storage round-trip — when the user picks one, the
 * bytes are POSTed to the existing /api/images upload route which
 * writes them to Meta's ad-image library and returns the hash.
 *
 * Square 1024×1024 is the default — close to Meta's 1080×1080 sweet
 * spot for Feed placements. Meta accepts 1024 fine.
 */

import OpenAI, { toFile } from "openai";
import { MAX_REFERENCES, type ReferenceRole } from "./studio-prompt";

const apiKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: apiKey ?? "missing-key" });

// gpt-image-1.5 is the sweet spot for THIS use case: newer than
// gpt-image-1 (better baked-in text), and it supports input_fidelity:"high"
// on edits — the lever that keeps an uploaded product faithful (the saree
// stays the SAME saree instead of drifting to a lookalike). NOTE: the
// even-newer gpt-image-2 hard-rejects input_fidelity (400), so it's a poor
// fit when product preservation matters — that's why it's not the default.
// Overridable via OPENAI_IMAGE_MODEL ("gpt-image-1" to fall back,
// "chatgpt-image-latest" to mirror the ChatGPT app); input_fidelity is sent
// only for models that accept it (see supportsInputFidelity). This is now
// only the DEFAULT — callers can override per request via input.model.
const DEFAULT_MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1.5";

// Which models accept the input_fidelity parameter on images.edit. The
// real API is stricter than the SDK's type docs — gpt-image-2 rejects it —
// so we keep an explicit allowlist and omit the param for anything else.
export function supportsInputFidelity(model: string): boolean {
  return model === "gpt-image-1" || model === "gpt-image-1.5";
}

// Reference bytes are always labelled "image/png" when handed to toFile,
// regardless of what they actually are — tolerated by OpenAI for a
// JPEG-labelled-PNG (the pre-existing AiStudioPanel path relies on this and
// works), but SVG or GIF bytes surface as an opaque 400 mid-generation
// instead of a clear upfront rejection. Callers that know the real content
// type (studio-client.tsx, for both its own uploads and kit references
// fetched through /api/media) can pass it through `references[].mimeType`;
// anything outside this allowlist is ignored and falls back to the
// historical "image/png" label rather than being trusted blindly.
const KNOWN_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
// 1024×1024 = square; matches Meta's preferred 1:1 ratio.
// 1024×1536 = portrait, useful for Stories/Reels — future toggle.
const DEFAULT_SIZE = "1024x1024" as const;

// "low" / "medium" / "high" trade quality for cost — roughly ₹1.5 / ₹4 / ₹15
// per image at 1024². Low is the right default for brainstorming variants;
// strategists can crank up to medium/high for the final pick.
export type ImageQuality = "low" | "medium" | "high";
// "medium" is the floor for legible baked-in promo typography. At "low"
// gpt-image-1 renders headline/offer/CTA text mushy and often misspelled,
// which defeats the whole point of a ready-to-ship promo creative.
const DEFAULT_QUALITY: ImageQuality = "medium";

// Craft frame — applies to EVERY ad regardless of format. Framing rules,
// photography direction and anti-AI-trope rules. Does NOT contain any
// promotional-layout instruction (occasion headline, offer figure, tagline,
// CTA button) — that's PROMO_FRAME below, added only when the caller wants
// the classic sale-ad layout — and does NOT contain the output-format /
// "brief follows" transition, which is stated once at the very end by
// OUTPUT_FRAME regardless of what else is in the prompt.
const CRAFT_FRAME = `You are a senior creative director at a top ad agency designing a FINISHED, READY-TO-SHIP Meta Ads creative for a client campaign. The output must look like work a senior designer would approve and publish as-is. NOT a generic AI image and NOT a bare photograph. Treat the brief as a creative brief, not a literal prompt.

FRAMING (non-negotiable, since failures here make the image unusable):
- The subject must be FULLY within the frame. No part of the body (head, face, hair, limbs, hands, fingers, feet) may be cut by the frame edges. Leave clean breathing room on all four sides.
- Keep all critical elements (the subject and every piece of text) within the centre 85% of the frame. Meta crops the edges for some placements (Stories, Reels, side bars); text clipped at an edge ruins the ad.
- Pick ONE intentional framing and execute it cleanly: head-and-shoulders, half-body, three-quarter, full body, or product close-up, with the typography balanced in the remaining space.
- Eye level should be deliberate (eye-level for connection, slight high-angle for product, slight low for aspirational). Never an awkward in-between.

PHOTOGRAPHY DIRECTION (this is what separates designer-grade from AI-grade):
- Treat the scene as a real photoshoot. Imagine a specific lens (85mm prime for portraits, 35mm for lifestyle, 50mm for product) and shallow but realistic depth of field, not the cartoonish fake-blur AI loves to default to.
- Natural, motivated lighting: a clear key light direction with believable fill. NEVER the flat, frontal, even softbox-into-the-face look that immediately reads "AI image".
- Realistic skin texture, visible pores, individual hair strands, real fabric drape and wrinkles, real shadows under chins / behind objects. Plastic skin and overly-smooth faces are an instant fail.
- Subtle editorial color grading: a coherent palette, not the over-saturated hyper-contrasted "AI default" look.
- A touch of film grain / texture is welcome when it fits the brand.

ANTI-AI-TROPE RULES (if you do any of these, the image is unusable):
- No symmetrical fake-perfect faces. Real humans are asymmetric. Vary the expression too. Don't default to "smiling at camera".
- No identical repeating bokeh circles. No "festival of perfectly round lights" unless the brief explicitly asks for it.
- No extra fingers, fused hands, floating limbs, melting jewellery.
- No misspelled, warped, doubled, or gibberish text: every character legible and correctly spelled.
- No fake brand marks other than a brand name the brief provides; no fake URLs, fake hashtags, or watermarks.
- No generic stock-photo poses. No "lady-presenting-her-laptop", no "diverse-team-laughing-at-nothing".`;

// Promotional-layout frame — the classic sale-ad composition: occasion
// headline, focal offer figure, tagline, CTA button. Correct for an Offer
// Stack format, wrong for a Founder Quote, Stat Drop, Advertorial or
// Anti-Ad. Added only when the caller wants it (see buildPrompt).
const PROMO_FRAME = `THIS IS A FULLY DESIGNED PROMOTIONAL CREATIVE, like a finished festive-sale ad you'd see in your Instagram feed: a striking subject/scene PLUS integrated headline, offer figure, tagline and a call-to-action button, all composed together as one publishable ad.

INTEGRATED PROMOTIONAL TYPOGRAPHY (bake it in, this is the point):
- Read the brief for the offer, occasion, discount/percentage, brand name, and any tagline, and render them AS DESIGNED TEXT in the creative.
- A clear headline / occasion line (e.g. "DIWALI OFFER", "FESTIVE SALE", "NEW ARRIVALS").
- A bold focal offer figure when the brief gives one (e.g. "FLAT 50% OFF", "UP TO 40% OFF"). Make it large, the second thing the eye lands on after the hero subject.
- A short supporting tagline when it fits ("Celebrate in style", "Timeless elegance").
- A call-to-action styled as a real clickable button/pill: "SHOP NOW" / "ORDER TODAY" / "GRAB THE DEAL".
- Spelling MUST be correct and match the brief exactly. Letters crisp, evenly kerned, professionally typeset, never warped, doubled, or gibberish. If unsure of a word, choose a simpler correct one.
- Use real type hierarchy (display headline → big offer → small tagline → button) and a palette that harmonises with the scene. Lay the text into negative space so it never covers a face or the hero.

COMPOSITION:
- Classic sale-ad layout: hero subject or product as the focal hero on one side, the typography block balanced on the other, unless the brief calls for something else.
- Clear focal hierarchy: hero subject first, offer figure second, supporting elements subordinate.
- Keep the offer figure and the call-to-action button inside the centre 85% along with everything else; a clipped offer or CTA kills the ad.
- Background must be intentional and brand-appropriate, with designed decorative framing where the occasion calls for it (festive borders, filigree, diyas, bokeh). NOT a generic blurred bokeh wall.
- Ornate decorative framing when the brief implies festive / luxury / cultural context: festive borders, art-deco corners, vintage filigree, ornamental motifs, themed visual frames.
- Layered backgrounds: foreground props → midground subject → richly designed background with bokeh / architecture / atmospheric depth. Every zone of the frame intentional.
- Lighting as a design tool: cinematic, directional key light, believable ambient warmth, atmospheric haze where the brief calls for it. NEVER flat frontal lighting.
- Props that contextualise the campaign (diyas, marigolds, brass lamps for festive; greenery and warm interior for lifestyle; gym equipment and morning light for fitness; etc.), clustered to frame the hero.
- Confident use of negative space, because that's where the text lives. Don't fill every pixel.

PRODUCTION QUALITY (the bar for a sale ad):
- Vogue India / Harper's Bazaar India / luxury festive-campaign level finish.
- NO sparse "props on white" look. NO white voids. NO blank studio backdrops unless the brief explicitly asks for one.
- NO clip-art, flat vector illustration, 2D-collage feel. This is a photographic creative with designed typography on top.
- NO sterile e-commerce "product on plain backdrop" feel. This is a campaign creative, not a catalogue listing.

A complete, designed, ready-to-publish promotional ad creative. If it wouldn't pass as a real published sale ad — if you wouldn't put this on a brand's Instagram grid — regenerate mentally before committing.`;

// Product-reference frame — used ONLY when a reference carrying the
// `product` role was supplied. Appended so the model preserves the exact
// product while it freestyles the scene around it.
//
// Everything here must be true of ANY ad built around a supplied product,
// because eleven of the seventeen studio formats require a reference and so
// reach this block. It therefore holds nothing about design language,
// production quality or sale-ad layout — that material moved to PROMO_FRAME,
// which `promoFrame: false` suppresses. It previously demanded a
// "Vogue India ... luxury festive-campaign finish" and a "classic sale-ad
// layout" on top of formats like sticky-note, whose own layout asks for a
// plain, unstyled phone photograph with no designed type. Framing and
// anti-AI-trope rules are stated once, in CRAFT_FRAME; only the
// product-specific safety bullets live here.
const PRODUCT_FRAME = `The strategist has uploaded a product photo as creative REFERENCE. Your job is to deliver a complete, publishable ad built around that product.

PRESERVE THE PRODUCT EXACTLY (use the reference image):
- The hero is the EXACT product shown in the reference photo (saree, garment, accessory, item being sold). Reproduce it FAITHFULLY: same colour, same fabric, same print/pattern, same border, same pallu, same embroidery / embellishment, same blouse. It must read as the SAME physical item a customer would actually receive, not a similar-looking one.
- Do NOT redesign, restyle, recolour, simplify, or "improve" the product. Its design stays identical. Your creative freedom is over the SCENE around it (the model, pose, lighting, background, decorative framing, layout and typography), NOT over the product itself.
- If the reference shows a person wearing/holding the product, you may restage the model and pose, but the garment itself must stay exactly as shown in the reference.
- The product is the visual HERO. The typography supports it, never covers or buries it.

PRODUCT FRAMING SAFETY (true of any ad built around a supplied product):
- The whole product must sit inside the frame with comfortable breathing room — never cropped by an edge, never bled off the side.
- NO text covering the product or the model's face.`;

/**
 * Stated once, at the end, whatever else is in the prompt. It used to live
 * inside CRAFT_FRAME in promotional wording ("finished sale ad", "extract the
 * offer, occasion and CTA"), which meant a format opting out of the promo
 * layout was still told to make a sale ad. Neutral here; PROMO_FRAME adds the
 * promotional emphasis back when it applies.
 */
const OUTPUT_FRAME = `OUTPUT FORMAT: 1:1 square, 1024×1024. A complete, designed, ready-to-publish Meta ad creative.

The brief follows. Read it as creative direction and fill in anything the strategist did not specify with designer-grade defaults.`;

/**
 * The craft rules apply to every ad. The promotional layout — occasion line,
 * focal offer figure, CTA pill, festive decoration — is added only when the
 * caller wants it, because it is a correct Offer Stack and a wrong Founder
 * Quote, Stat Drop or Advertorial.
 *
 * Callers that pass promoFrame: false are supplying their own LAYOUT section
 * inside the brief (the studio's format presets do exactly that), so adding
 * this block would state the frame twice. Callers that pass nothing keep the
 * promotional default, which is what /api/ai/ad-generate and AiStudioPanel
 * have always produced.
 *
 * Composition order is CRAFT_FRAME, then PROMO_FRAME when enabled, then
 * PRODUCT_FRAME when a product reference is present, then OUTPUT_FRAME, then
 * the brief — so the "brief follows" transition genuinely precedes the
 * brief in every flag combination, and there is exactly one OUTPUT FORMAT
 * block no matter how many of the optional frames are included.
 */
function buildPrompt(
  brief: string,
  opts: {
    tweakInstruction?: string;
    withProductReference?: boolean;
    promoFrame?: boolean;
  } = {},
): string {
  const tweak = opts.tweakInstruction?.trim()
    ? `\n\nIMPORTANT MODIFICATION FROM THE STRATEGIST: ${opts.tweakInstruction.trim()}`
    : "";
  const promo = opts.promoFrame === false ? "" : `\n\n${PROMO_FRAME}`;
  const product = opts.withProductReference ? `\n\n${PRODUCT_FRAME}` : "";
  return `${CRAFT_FRAME}${promo}${product}\n\n${OUTPUT_FRAME}\n\nBRIEF:\n${brief.trim()}${tweak}`;
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
  /**
   * Optional base64 of a product photo (no data: prefix). When present
   * we route to images.edit() with no mask — gpt-image-1 freestyles a
   * finished ad creative using the photo as creative reference. The
   * product appears RECOGNISABLY in each variant but is not pixel-
   * faithful — model is free to redesign pose, drape, framing.
   *
   * Retained for backwards compatibility with existing callers. New
   * callers should use `references` instead; when `references` is
   * absent this is normalised into a single `{ role: "product" }` entry.
   */
  productReferenceB64?: string;
  /**
   * Ordered reference images, each with the role the prompt should describe
   * it as. Replaces the single productReferenceB64 for new callers; that
   * field is retained so existing callers keep working, and is treated as
   * a single { role: "product" } entry when present.
   *
   * Capped at MAX_REFERENCES in total — the product photo and logo count
   * toward it. Beyond a handful the model averages references into mush.
   */
  references?: Array<{ b64: string; role: ReferenceRole; mimeType?: string }>;
  /**
   * Per-request override of the image model. Defaults to DEFAULT_MODEL
   * (env OPENAI_IMAGE_MODEL or "gpt-image-1.5") when omitted.
   */
  model?: string;
  /**
   * Whether to add the built-in promotional layout block (occasion headline,
   * focal offer figure, CTA pill, festive decoration). Defaults to true, so
   * every pre-existing caller is unchanged. The studio passes false when a
   * format preset has already supplied a LAYOUT section in the brief.
   */
  promoFrame?: boolean;
}

/**
 * Pattern signal — surfaced to the API + UI so we can show the
 * strategist which generation path ran:
 *
 *  - "from-scratch": no product reference. Pure text-to-image.
 *  - "product-reference": product photo provided. Freestyle ad-creative
 *    generation using the photo as reference. Product is RECOGNISABLE
 *    but not pixel-identical.
 */
export type GenerationPattern = "from-scratch" | "product-reference";

export async function generateAdImages(
  input: GenerateAdImageInput,
): Promise<{
  variants: AdImageVariant[];
  prompt: string;
  pattern: GenerationPattern;
}> {
  const brief = input.brief?.trim();
  if (!brief) throw new Error("brief is required");
  const count = Math.max(1, Math.min(4, input.count ?? 2));
  const quality = input.quality ?? DEFAULT_QUALITY;
  const model = input.model?.trim() || DEFAULT_MODEL;

  // Normalise references: new callers pass `references` directly; old
  // callers pass the single `productReferenceB64` field, which becomes a
  // single { role: "product" } entry when `references` isn't given.
  const productB64 = input.productReferenceB64?.trim();
  let references = input.references?.length
    ? input.references
    : productB64
      ? [{ b64: productB64, role: "product" as ReferenceRole }]
      : [];
  // Defensive backstop for non-HTTP callers — the route (the user-facing
  // contract) rejects an oversized array outright instead of truncating.
  if (references.length > MAX_REFERENCES) {
    references = references.slice(0, MAX_REFERENCES);
  }

  const hasProductRole = references.some((r) => r.role === "product");

  let variants: AdImageVariant[] = [];
  let prompt: string;
  let pattern: GenerationPattern;

  if (references.length === 0) {
    // No references → text-to-image from scratch.
    pattern = "from-scratch";
    prompt = buildPrompt(brief, { promoFrame: input.promoFrame });
    const res = await openai.images.generate({
      model,
      prompt,
      n: count,
      size: DEFAULT_SIZE,
      quality,
    });
    variants = (res.data ?? [])
      .filter((d): d is { b64_json: string } => Boolean(d.b64_json))
      .map((d) => ({ b64: d.b64_json, mimeType: "image/png" }));
  } else {
    // Reference(s) provided → freestyle ad-creative edit. gpt-image-1
    // sees the photo(s) as inspiration and designs a complete, finished
    // creative around them. No mask, no compositing — the model owns
    // the design end-to-end.
    pattern = hasProductRole ? "product-reference" : "from-scratch";
    prompt = buildPrompt(brief, {
      withProductReference: hasProductRole,
      promoFrame: input.promoFrame,
    });
    const sourceFiles = await Promise.all(
      references.map((ref, i) => {
        const mimeType =
          ref.mimeType && KNOWN_REFERENCE_MIME_TYPES.has(ref.mimeType)
            ? ref.mimeType
            : "image/png";
        const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
        return toFile(Buffer.from(ref.b64, "base64"), `reference-${i}-${ref.role}.${ext}`, {
          type: mimeType,
        });
      }),
    );
    const res = await openai.images.edit({
      model,
      // The OpenAI SDK (v6.42.0) types `image` as `Uploadable |
      // Array<Uploadable>` for GPT image models — up to 16 images accepted
      // — so we hand it every reference rather than dropping to one.
      image: sourceFiles,
      prompt,
      n: count,
      size: DEFAULT_SIZE,
      quality,
      // The whole reason the product used to drift into a lookalike:
      // input_fidelity defaults to "low", which treats the upload as loose
      // inspiration. "high" makes the model preserve the actual garment —
      // same pattern, pallu, border, blouse — while still freely designing
      // the scene + typography around it. Only sent for models that accept
      // it (gpt-image-2 hard-rejects it with a 400).
      ...(supportsInputFidelity(model)
        ? { input_fidelity: "high" as const }
        : {}),
    });
    variants = (res.data ?? [])
      .filter((d): d is { b64_json: string } => Boolean(d.b64_json))
      .map((d) => ({ b64: d.b64_json, mimeType: "image/png" }));
  }

  if (variants.length === 0) {
    throw new Error("OpenAI returned no image data");
  }
  return { variants, prompt, pattern };
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
  /**
   * Per-request override of the image model, same field as
   * GenerateAdImageInput.model. Defaults to DEFAULT_MODEL when omitted —
   * that default is also what the pre-existing AiStudioPanel caller gets,
   * since it never sends this field. Without threading this through,
   * generating on one model (e.g. gpt-image-2) and then tweaking silently
   * ran the edit on a DIFFERENT model (always DEFAULT_MODEL /
   * gpt-image-1.5), producing a visibly different renderer on the same
   * image — the exact "why does my product look different?" failure the
   * fidelity section above exists to prevent.
   */
  model?: string;
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
  const model = input.model?.trim() || DEFAULT_MODEL;

  // Prompt is framed as "edit this image" so the model treats the input
  // as the canonical composition and applies only the requested change.
  // Framing rules are restated so the edit doesn't accidentally crop the
  // subject — a common failure mode for image-to-image edits.
  const prompt = `You are a senior retoucher editing a Meta ad creative. Apply this change precisely and ONLY this change: ${instruction}.

Preserve EVERYTHING ELSE from the original: same subject identity, same face, same composition and pose framing, same clothing, same lighting style, same background, same color palette, and every existing text element exactly as it appears. Do not invent new elements. Do not add any text that is not already in the image. Do not re-pose the subject. Do not re-frame the shot.

FRAMING (must hold after the edit):
- The subject must still be fully within the frame. Do not crop the head, hands, or feet at the edges.
- Keep the subject and every piece of text within the centre 85% of the frame.
- Maintain the original aspect ratio and zoom level.

TEXT (handle whatever typography the creative already carries, and add none):
- Unless the instruction explicitly asks you to change the wording, preserve every existing text element exactly as it appears — same words, same spelling, same placement, same type style.
- Do NOT add any text the image does not already contain. In particular do not add a headline, an offer or discount figure, a tagline, a price, a badge or a call-to-action button that is not already there. Many of these creatives deliberately carry no offer and no CTA.
- If the instruction does change the text, render the new wording crisp, correctly spelled, evenly kerned, and in the same type style/hierarchy as the original.
- Never warp, double, or garble existing letters while applying an unrelated edit.

QUALITY:
- Realistic skin / hair / fabric texture. No plastic-skin smoothing.
- No new watermarks, fake brand marks, or fake URLs.
- No extra fingers, fused hands, melting accessories.${
    brief ? `\n\nOriginal creative brief for context: ${brief}` : ""
  }`;

  const res = await openai.images.edit({
    model,
    image: sourceFile,
    prompt,
    size: DEFAULT_SIZE,
    quality: input.quality ?? DEFAULT_QUALITY,
    // Preserve the source faithfully — a tweak should change only what's
    // asked, not silently regenerate the product / text into a lookalike.
    // Only sent for models that accept it (gpt-image-2 rejects it). Do NOT
    // change which models supportsInputFidelity() accepts — gpt-image-2
    // 400s on input_fidelity, so that allowlist is load-bearing.
    ...(supportsInputFidelity(model) ? { input_fidelity: "high" as const } : {}),
  });

  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return { variant: { b64, mimeType: "image/png" }, prompt };
}
