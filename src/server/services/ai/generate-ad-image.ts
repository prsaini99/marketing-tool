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
// only for models that accept it (see supportsInputFidelity).
const MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1.5";

// Which models accept the input_fidelity parameter on images.edit. The
// real API is stricter than the SDK's type docs — gpt-image-2 rejects it —
// so we keep an explicit allowlist and omit the param for anything else.
function supportsInputFidelity(model: string): boolean {
  return model === "gpt-image-1" || model === "gpt-image-1.5";
}
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

// System frame for from-scratch (no product reference). The model has
// to invent everything from a brief, so we keep the photography /
// anti-AI-trope rules verbose. Like the product-reference path, this now
// delivers a FINISHED PROMOTIONAL CREATIVE with the offer + CTA designed
// into the image — not a bare photograph.
const SYSTEM_FRAME = `You are a senior creative director at a top ad agency designing a FINISHED, READY-TO-SHIP Meta Ads PROMOTIONAL CREATIVE for a client campaign. The output must look like a polished sale/festive ad a senior designer would approve and publish as-is — NOT a generic AI image and NOT a bare photograph. Treat the brief as a creative brief, not a literal prompt.

THIS IS A FULLY DESIGNED PROMOTIONAL CREATIVE — like a finished festive-sale ad you'd see in your Instagram feed: a striking subject/scene PLUS integrated headline, offer figure, tagline and a call-to-action button, all composed together as one publishable ad.

INTEGRATED PROMOTIONAL TYPOGRAPHY (bake it in — this is the point):
- Read the brief for the offer, occasion, discount/percentage, brand name, and any tagline, and render them AS DESIGNED TEXT in the creative.
- A clear headline / occasion line (e.g. "DIWALI OFFER", "FESTIVE SALE", "NEW ARRIVALS").
- A bold focal offer figure when the brief gives one (e.g. "FLAT 50% OFF", "UP TO 40% OFF") — large, the second thing the eye lands on after the hero subject.
- A short supporting tagline when it fits ("Celebrate in style", "Timeless elegance").
- A call-to-action styled as a real clickable button/pill — "SHOP NOW" / "ORDER TODAY" / "GRAB THE DEAL".
- Spelling MUST be correct and match the brief exactly. Letters crisp, evenly kerned, professionally typeset — never warped, doubled, or gibberish. If unsure of a word, choose a simpler correct one.
- Use real type hierarchy (display headline → big offer → small tagline → button) and a palette that harmonises with the scene. Lay the text into negative space so it never covers a face or the hero.

FRAMING (non-negotiable — failures here make the image unusable):
- The subject must be FULLY within the frame. No part of the body — head, face, hair, limbs, hands, fingers, feet — may be cut by the frame edges. Leave clean breathing room on all four sides.
- Keep all critical elements — subject, offer figure, CTA — within the centre 85% of the frame. Meta crops the edges for some placements (Stories, Reels, side bars); text clipped at an edge ruins the ad.
- Pick ONE intentional framing and execute it cleanly: head-and-shoulders, half-body, three-quarter, full body, or product close-up, with the typography balanced in the remaining space.
- Eye level should be deliberate (eye-level for connection, slight high-angle for product, slight low for aspirational). Never an awkward in-between.

COMPOSITION:
- Classic sale-ad layout — hero subject on one side, typography block balanced on the other — unless the brief calls for something else.
- Clear focal hierarchy: hero subject first, offer figure second, supporting elements subordinate.
- Background must be intentional and brand-appropriate, with designed decorative framing where the occasion calls for it (festive borders, filigree, diyas, bokeh). NOT a generic blurred bokeh wall.
- Confident use of negative space — that's where the text lives. Don't fill every pixel.

PHOTOGRAPHY DIRECTION (this is what separates designer-grade from AI-grade):
- Treat the scene as a real photoshoot. Imagine a specific lens (85mm prime for portraits, 35mm for lifestyle, 50mm for product) and shallow but realistic depth of field — not the cartoonish fake-blur AI loves to default to.
- Natural, motivated lighting — a clear key light direction with believable fill. NEVER the flat, frontal, even softbox-into-the-face look that immediately reads "AI image".
- Realistic skin texture, visible pores, individual hair strands, real fabric drape and wrinkles, real shadows under chins / behind objects. Plastic skin and overly-smooth faces are an instant fail.
- Subtle editorial color grading — a coherent palette, not the over-saturated hyper-contrasted "AI default" look.
- A touch of film grain / texture is welcome when it fits the brand.

ANTI-AI-TROPE RULES (if you do any of these, the image is unusable):
- No symmetrical fake-perfect faces. Real humans are asymmetric. Vary the expression too — don't default to "smiling at camera".
- No identical repeating bokeh circles. No "festival of perfectly round lights" unless the brief explicitly asks for it.
- No extra fingers, fused hands, floating limbs, melting jewellery.
- No misspelled, warped, doubled, or gibberish text — every character legible and correctly spelled.
- No fake brand marks other than a brand name the brief provides; no fake URLs, fake hashtags, or watermarks.
- No generic stock-photo poses. No "lady-presenting-her-laptop", no "diverse-team-laughing-at-nothing".

OUTPUT FORMAT:
- 1:1 square, 1024×1024.
- A complete, designed, ready-to-publish promotional ad creative. If you wouldn't put this on a brand's Instagram grid as a finished sale ad, regenerate mentally before committing.

The brief follows. Read it as creative direction for the FULL designed promo ad — extract the offer, occasion and CTA from it, and fill in everything else with designer-grade defaults.`;

// Product-reference frame — used when the strategist uploaded a product
// photo. This is the prompt that does the heaviest lifting: the model
// sees the reference image AND this prompt, and has to deliver a
// finished, ready-to-ship promotional creative — product + scene +
// baked-in offer typography + CTA — not a sterile photograph of just
// the product. The ChatGPT-style "complete designed promo creative"
// language is what gets us out of "props on white" territory and into
// finished-sale-ad land.
const PRODUCT_REFERENCE_FRAME = `You are a senior creative director at a top ad agency designing a FINISHED, READY-TO-SHIP Meta Ads PROMOTIONAL CREATIVE for a client campaign. The strategist has uploaded a product photo as creative REFERENCE — your job is to deliver a complete, publishable promotional ad built around that product, WITH the offer typography and call-to-action designed directly into the image.

THIS IS A FULLY DESIGNED PROMOTIONAL CREATIVE — NOT A RAW PHOTOGRAPH.
The output should read like a finished festive-sale ad you'd scroll past on Instagram: model + product as the hero, decorative framing, AND integrated headline, offer figure, tagline and a "SHOP NOW" button — every element composed together as ONE publishable ad. Think premium-brand sale creative, not a documentary photo or sparse studio shot.

THE PRODUCT — PRESERVE IT EXACTLY (use the reference image):
- The hero is the EXACT product shown in the reference photo (saree, garment, accessory, item being sold). Reproduce it FAITHFULLY: same colour, same fabric, same print/pattern, same border, same pallu, same embroidery / embellishment, same blouse. It must read as the SAME physical item a customer would actually receive — not a similar-looking one.
- Do NOT redesign, restyle, recolour, simplify, or "improve" the product. Its design stays identical. Your creative freedom is over the SCENE around it — the model, pose, lighting, background, decorative framing, layout and typography — NOT over the product itself.
- If the reference shows a person wearing/holding the product, you may restage the model and pose, but the garment itself must stay exactly as shown in the reference.
- The product is the visual HERO. The typography supports it, never covers or buries it.

INTEGRATED PROMOTIONAL TYPOGRAPHY (bake it in — this is the point):
- Read the brief for the offer, occasion, discount/percentage, brand name, and any tagline, and render them AS DESIGNED TEXT in the creative.
- A clear headline / occasion line (e.g. "DIWALI OFFER", "FESTIVE SALE", "NEW ARRIVALS").
- A bold focal offer figure when the brief gives one (e.g. "FLAT 50% OFF", "UP TO 40% OFF") — large, the second thing the eye lands on after the product.
- A short supporting tagline when it fits ("Celebrate in style", "Timeless elegance").
- A call-to-action styled as a real clickable button/pill — "SHOP NOW" / "ORDER TODAY" / "GRAB THE DEAL".
- Spelling MUST be correct and match the brief exactly. Letters crisp, evenly kerned, professionally typeset — never warped, doubled, or gibberish. If unsure of a word, choose a simpler correct one.
- Typography palette must harmonise with the scene (e.g. gold/cream on deep festive tones). Use real type hierarchy — display headline → big offer → small tagline → button.
- Lay the text into the negative space (one side / top / bottom) so it never covers the product or the model's face.

DESIGN LANGUAGE (this is what separates an ad creative from a photo):
- Ornate decorative framing when the brief implies festive / luxury / cultural context — festive borders, art-deco corners, vintage filigree, ornamental motifs, themed visual frames.
- Editorial composition — classic sale-ad layout, model + product as the focal hero on one side, the typography block balanced on the other, intentional negative space.
- Layered backgrounds: foreground props → midground subject → richly designed background with bokeh / architecture / atmospheric depth. Every zone of the frame intentional.
- Lighting as a design tool — cinematic, directional key light, believable ambient warmth, atmospheric haze where the brief calls for it. NEVER flat frontal lighting.
- Props that contextualise the campaign (diyas, marigolds, brass lamps for festive; greenery and warm interior for lifestyle; gym equipment and morning light for fitness; etc.) — clustered to frame the hero.

PRODUCTION QUALITY (the bar):
- Vogue India / Harper's Bazaar India / luxury festive-campaign level finish.
- Real lens look (85mm portrait, 50mm lifestyle) with shallow realistic depth of field.
- Realistic skin, hair, fabric texture. No plastic AI-default skin.
- Subtle film grain. Coherent editorial colour grade.
- Finished-ad quality — if it wouldn't pass as a real published sale ad, regenerate mentally.

FRAMING:
- Subject + product + all text fully within the frame, comfortable breathing room on all sides.
- Keep every critical element (product, face, offer figure, CTA) within the centre 85% — Meta crops the edges on some placements; text clipped at an edge ruins the ad.
- Pick one intentional framing — head-and-shoulders, half-body, three-quarter, full body — and execute cleanly, with the typography balanced in the remaining space.

ABSOLUTELY FORBIDDEN — INSTANT FAIL:
- NO misspelled, warped, doubled, or gibberish text. Every character legible and correctly spelled.
- NO text covering the product or the model's face.
- NO sparse "props on white" look. NO white voids. NO blank studio backdrops unless the brief explicitly asks for one.
- NO clip-art, flat vector illustration, 2D-collage feel — this is a photographic creative with designed typography on top.
- NO extra fingers, fused hands, melting jewellery, asymmetric perfect-AI faces.
- NO fake brand marks other than a brand name the brief provides; no fake URLs, fake hashtags, or watermarks.
- NO sterile e-commerce "product on plain backdrop" feel — this is a campaign creative, not a catalogue listing.

OUTPUT FORMAT: 1:1 square, 1024×1024. A complete, designed, ready-to-publish Meta promotional ad creative with the offer and CTA baked in.

The brief follows. Read it as creative direction for the FULL designed promo ad — extract the offer, occasion and CTA from it, and fill in everything the strategist didn't specify with designer-grade defaults.`;

function buildPrompt(
  brief: string,
  opts: { tweakInstruction?: string; withProductReference?: boolean } = {},
): string {
  const tweak = opts.tweakInstruction?.trim()
    ? `\n\nIMPORTANT MODIFICATION FROM THE STRATEGIST: ${opts.tweakInstruction.trim()}`
    : "";
  const frame = opts.withProductReference ? PRODUCT_REFERENCE_FRAME : SYSTEM_FRAME;
  const briefLabel = opts.withProductReference
    ? "BRIEF (creative direction for the designed ad)"
    : "CREATIVE BRIEF";
  return `${frame}\n\n${briefLabel}:\n${brief.trim()}${tweak}`;
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
   */
  productReferenceB64?: string;
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
  const productB64 = input.productReferenceB64?.trim();

  let variants: AdImageVariant[] = [];
  let prompt: string;
  let pattern: GenerationPattern;

  if (!productB64) {
    // No product reference → text-to-image from scratch.
    pattern = "from-scratch";
    prompt = buildPrompt(brief);
    const res = await openai.images.generate({
      model: MODEL,
      prompt,
      n: count,
      size: DEFAULT_SIZE,
      quality,
    });
    variants = (res.data ?? [])
      .filter((d): d is { b64_json: string } => Boolean(d.b64_json))
      .map((d) => ({ b64: d.b64_json, mimeType: "image/png" }));
  } else {
    // Product reference → freestyle ad-creative edit. gpt-image-1
    // sees the photo as inspiration and designs a complete, finished
    // creative around it. No mask, no compositing — the model owns
    // the design end-to-end.
    pattern = "product-reference";
    prompt = buildPrompt(brief, { withProductReference: true });
    const buffer = Buffer.from(productB64, "base64");
    const sourceFile = await toFile(buffer, "product-reference.png", {
      type: "image/png",
    });
    const res = await openai.images.edit({
      model: MODEL,
      image: sourceFile,
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
      ...(supportsInputFidelity(MODEL)
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

Preserve EVERYTHING ELSE from the original — same subject identity, same face, same composition and pose framing, same clothing, same lighting style, same background, same color palette, and the SAME designed promotional text (headline, offer figure, tagline, CTA button). Do not invent new elements. Do not re-pose the subject. Do not re-frame the shot.

FRAMING (must hold after the edit):
- The subject must still be fully within the frame. Do not crop the head, hands, or feet at the edges.
- Keep critical elements — subject, offer figure, CTA — within the centre 85% of the frame.
- Maintain the original aspect ratio and zoom level.

TEXT (the creative carries designed promotional typography — handle it carefully):
- Unless the instruction explicitly asks you to change the wording, keep every existing text element identical and correctly spelled — headline, offer figure (e.g. "FLAT 50% OFF"), tagline, and CTA button.
- If the instruction does change the text, render the new wording crisp, correctly spelled, evenly kerned, and in the same type style/hierarchy as the original.
- Never warp, double, or garble existing letters while applying an unrelated edit.

QUALITY:
- Realistic skin / hair / fabric texture. No plastic-skin smoothing.
- No new watermarks, fake brand marks, or fake URLs.
- No extra fingers, fused hands, melting accessories.${
    brief ? `\n\nOriginal creative brief for context: ${brief}` : ""
  }`;

  const res = await openai.images.edit({
    model: MODEL,
    image: sourceFile,
    prompt,
    size: DEFAULT_SIZE,
    quality: input.quality ?? DEFAULT_QUALITY,
    // Preserve the source faithfully — a tweak should change only what's
    // asked, not silently regenerate the product / text into a lookalike.
    // Only sent for models that accept it (gpt-image-2 rejects it).
    ...(supportsInputFidelity(MODEL)
      ? { input_fidelity: "high" as const }
      : {}),
  });

  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return { variant: { b64, mimeType: "image/png" }, prompt };
}
