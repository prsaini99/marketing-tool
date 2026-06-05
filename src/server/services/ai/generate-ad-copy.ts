/**
 * Brand-voice ad-copy generation.
 *
 * Workflow:
 *   1. Resolve the account → its local id (tenant scope).
 *   2. RAG-retrieve the top-K most-similar past creatives in this account
 *      ("ads" namespace) — these become the brand-voice reference for the
 *      LLM. If the account has no indexed copy yet (new client, never
 *      backfilled), we still generate, just without brand-voice grounding.
 *   3. Call the LLM with a structured-output schema so we get back a
 *      strictly-typed array of { headline, primaryText, description } —
 *      no regex-parsing, no malformed JSON to handle.
 *
 * The LLM picks distinct angles / hooks across variants on its own; we just
 * ask for N. Keep `count` modest (3–8) — too many and they start sounding
 * same-y.
 *
 * The retrieved chunks are returned alongside the variants so the UI can
 * show "based on these past ads" as a transparency affordance — clients
 * appreciate seeing what the model was steered by.
 */

import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/llm/chat";
import {
  formatHitsForPrompt,
  search,
  type SearchHit,
} from "@/server/services/rag";

export interface GenerateAdCopyInput {
  metaAdAccountId: string;
  /** Free-form brief — product, offer, audience, tone, anything useful. */
  brief: string;
  /** How many variants to produce. Clamped to 1–8. Defaults to 5. */
  count?: number;
}

export interface AdCopyVariant {
  headline: string;
  primaryText: string;
  description: string;
}

export interface GenerateAdCopyResult {
  variants: AdCopyVariant[];
  /**
   * The past creatives that informed the generation — let the UI show
   * "grounded in these" for transparency.
   */
  groundedIn: Array<{ sourceId: string; content: string }>;
}

// JSON schema for OpenAI structured outputs. `strict: true` (set in chat.ts)
// guarantees the response parses as this exact shape.
const VARIANTS_SCHEMA = {
  name: "ad_copy_variants",
  schema: {
    type: "object",
    properties: {
      variants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            headline: {
              type: "string",
              description:
                "Short headline (~40 chars). Punchy, leads with the hook.",
            },
            primaryText: {
              type: "string",
              description:
                "Body copy above the image. 1–3 short sentences, lead-with-hook.",
            },
            description: {
              type: "string",
              description:
                "Optional small text under the headline. May be empty string.",
            },
          },
          required: ["headline", "primaryText", "description"],
          additionalProperties: false,
        },
      },
    },
    required: ["variants"],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You are a senior Meta Ads copywriter for a digital marketing agency. Your job is to write ad copy that sounds like the brand's existing voice (shown in the retrieved context, if any) and follows direct-response best practices.

Rules for every variant:
- Match the brand's tone, vocabulary, and rhythm from the retrieved past ads. Do NOT invent a generic voice.
- Each variant should take a distinct angle, hook, or framing — vary the lead, the emotion, or the offer angle.
- Headlines under ~40 characters where possible; primary text 1–3 short sentences max.
- No emojis unless the brand's past ads use them. No hashtags. No clichés ("game-changer", "revolutionary", "unlock").
- Description is optional — emit "" if there's nothing meaningful to add.

If no past brand context is provided, write neutral, well-crafted direct-response copy and note that variants may need tuning to fit the brand.`;

export async function generateAdCopy(
  input: GenerateAdCopyInput,
): Promise<GenerateAdCopyResult> {
  const brief = input.brief?.trim();
  if (!brief) throw new Error("brief is required");

  const count = Math.max(1, Math.min(8, input.count ?? 5));

  const metaAdAccountId = input.metaAdAccountId.startsWith("act_")
    ? input.metaAdAccountId
    : `act_${input.metaAdAccountId}`;
  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId, selectedForSync: true },
    select: { id: true },
  });
  if (!account) {
    throw new Error("Ad account not found or not selected for sync");
  }

  // Pull brand voice from past creatives in this account. Empty list is OK —
  // the LLM is instructed to handle that case explicitly.
  let hits: SearchHit[] = [];
  try {
    hits = await search({
      query: brief,
      namespace: "ads",
      adAccountId: account.id,
      topK: 8,
    });
  } catch (err) {
    // Don't fail generation on a retrieval error — fall back to no context.
    console.error("ad-copy RAG retrieval failed:", err);
  }

  const context = hits.length > 0 ? formatHitsForPrompt(hits) : undefined;

  const userPrompt = `Brief from the strategist:
${brief}

Generate exactly ${count} ad copy variants. Each variant must be DISTINCT from the others in angle or hook.`;

  const result = await completeJson<{ variants: AdCopyVariant[] }>(
    userPrompt,
    {
      system: SYSTEM_PROMPT,
      context,
      // A touch of creative range — too low and variants converge.
      temperature: 0.85,
      maxTokens: 2000,
    },
    VARIANTS_SCHEMA,
  );

  return {
    variants: result.variants,
    groundedIn: hits.map((h) => ({
      sourceId: h.sourceId,
      content: h.content,
    })),
  };
}

// ── Tweak a single variant ──────────────────────────────────────────────
//
// "I like this variant but make it shorter / more urgent / drop the price /
// add a discount mention." Lets the strategist iterate on a winner without
// regenerating the whole batch and losing their pick. Still grounded in
// brand-voice (same RAG retrieval) but the model is asked to start from the
// chosen variant and apply ONLY the tweak — no full rewrite.

export interface TweakAdCopyInput {
  metaAdAccountId: string;
  /** The original brief that produced the variant — keeps context. */
  brief: string;
  /** The variant the strategist liked and wants modified. */
  original: AdCopyVariant;
  /** The change request, in plain English. */
  instruction: string;
}

const TWEAK_SYSTEM_PROMPT = `You are refining ONE ad-copy variant for an agency strategist who already picked it. They want a small change, not a full rewrite. Apply the instruction precisely and preserve everything else from the original — same hook, same length feel, same brand voice (shown in retrieved context if any).

Rules:
- Treat the instruction as a surgical edit, not a brief. Don't reframe the variant unless the instruction explicitly says to.
- Keep word count similar to the original unless the instruction calls for shorter/longer.
- Stay in the brand voice from the retrieved past ads. Don't drift toward a generic AI tone.
- All three fields stay populated: headline, primaryText, description (empty string is OK only if it was empty in the original).
- No clichés ("game-changer", "revolutionary", "unlock"). No emojis unless the brand uses them.`;

const SINGLE_VARIANT_SCHEMA = {
  name: "ad_copy_single_variant",
  schema: {
    type: "object",
    properties: {
      variant: {
        type: "object",
        properties: {
          headline: { type: "string" },
          primaryText: { type: "string" },
          description: { type: "string" },
        },
        required: ["headline", "primaryText", "description"],
        additionalProperties: false,
      },
    },
    required: ["variant"],
    additionalProperties: false,
  },
};

export async function tweakAdCopy(
  input: TweakAdCopyInput,
): Promise<{ variant: AdCopyVariant }> {
  const brief = input.brief?.trim();
  const instruction = input.instruction?.trim();
  if (!instruction) throw new Error("instruction is required");

  const metaAdAccountId = input.metaAdAccountId.startsWith("act_")
    ? input.metaAdAccountId
    : `act_${input.metaAdAccountId}`;
  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId, selectedForSync: true },
    select: { id: true },
  });
  if (!account) {
    throw new Error("Ad account not found or not selected for sync");
  }

  let hits: SearchHit[] = [];
  try {
    hits = await search({
      query: brief || input.original.primaryText,
      namespace: "ads",
      adAccountId: account.id,
      topK: 5, // smaller than full-generate — the brand-voice anchor is the
      // original variant itself, retrieval is just supporting reference.
    });
  } catch (err) {
    console.error("ad-copy tweak RAG retrieval failed:", err);
  }

  const context = hits.length > 0 ? formatHitsForPrompt(hits) : undefined;

  const userPrompt = `Original brief (for context):
${brief || "(none provided)"}

Variant the strategist liked:
  Headline:     ${input.original.headline}
  Primary text: ${input.original.primaryText}
  Description:  ${input.original.description || "(empty)"}

Apply this change and return the modified variant:
${instruction}`;

  const result = await completeJson<{ variant: AdCopyVariant }>(
    userPrompt,
    {
      system: TWEAK_SYSTEM_PROMPT,
      context,
      // Lower than generate — we want a surgical edit, not creative drift.
      temperature: 0.5,
      maxTokens: 500,
    },
    SINGLE_VARIANT_SCHEMA,
  );

  return { variant: result.variant };
}
