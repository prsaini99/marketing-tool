/**
 * The creative taxonomy — pure module, no I/O.
 *
 * A FIXED, CLOSED vocabulary is the entire point. Letting the model invent
 * its own labels produces "urgency", "Urgency", "time-pressure" and
 * "scarcity/urgency" across four runs of the same prompt, and then nothing
 * can be aggregated: every group has n=1 and the feature says nothing. A
 * closed set means "question hooks beat statements 2.1x in this account" is
 * a query, not an essay.
 *
 * `TAXONOMY_VERSION` is stamped onto every classified row. When a dimension
 * changes, bump it — that is what makes a re-tagging pass identifiable
 * ("re-classify everything below v2") instead of a guess about which rows
 * are stale. Never silently edit a label's meaning without bumping.
 *
 * All dimensions carry "other" / "unknown" escapes on purpose. Forcing a
 * creative into the nearest wrong bucket corrupts the aggregate more than
 * an honest "unknown" does, and an unusually large `unknown` group is
 * itself the signal that the taxonomy needs a new label.
 */

export const TAXONOMY_VERSION = 1;

export const HOOK_TYPES = [
  "question", // "Still paying for X?"
  "statement", // "The fastest way to X."
  "statistic", // "93% of teams do X wrong."
  "problem", // leads with the pain
  "social_proof", // testimonial / customer count / rating
  "offer", // discount, deal, limited time
  "how_to", // instructional framing
  "story", // narrative / personal anecdote
  "curiosity", // withholds the payoff
  "comparison", // us vs them, before/after
  "other",
] as const;

export const FUNNEL_STAGES = ["TOFU", "MOFU", "BOFU", "unknown"] as const;

export const CREATIVE_ANGLES = [
  "price_value",
  "quality",
  "convenience",
  "urgency",
  "trust_authority",
  "aspiration",
  "fear_of_missing_out",
  "problem_solution",
  "novelty",
  "other",
] as const;

export type HookType = (typeof HOOK_TYPES)[number];
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export type CreativeAngle = (typeof CREATIVE_ANGLES)[number];

export interface CreativeTags {
  hookType: HookType;
  funnelStage: FunnelStage;
  angle: CreativeAngle;
  /** Free text, <= 8 words — the specific promise, e.g. "same-day delivery". */
  usp: string;
  /** Free text, <= 6 words — e.g. "small business owners". */
  persona: string;
  taxonomyVersion: number;
}

/** Human labels for the UI. Keys must stay in sync with the arrays above. */
export const HOOK_LABELS: Record<HookType, string> = {
  question: "Question",
  statement: "Statement",
  statistic: "Statistic",
  problem: "Problem-led",
  social_proof: "Social proof",
  offer: "Offer",
  how_to: "How-to",
  story: "Story",
  curiosity: "Curiosity",
  comparison: "Comparison",
  other: "Other",
};

export const ANGLE_LABELS: Record<CreativeAngle, string> = {
  price_value: "Price / value",
  quality: "Quality",
  convenience: "Convenience",
  urgency: "Urgency",
  trust_authority: "Trust / authority",
  aspiration: "Aspiration",
  fear_of_missing_out: "FOMO",
  problem_solution: "Problem / solution",
  novelty: "Novelty",
  other: "Other",
};

/**
 * JSON schema handed to `completeJson`. Enums are enforced at the API
 * boundary, so an out-of-vocabulary label is a retry rather than a silently
 * corrupt row — this is why the taxonomy is worth expressing as a schema
 * instead of merely describing it in the prompt.
 */
export const CREATIVE_TAGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "hookType", "funnelStage", "angle", "usp", "persona"],
        properties: {
          id: { type: "string", description: "The creative id given in the input" },
          hookType: { type: "string", enum: [...HOOK_TYPES] },
          funnelStage: { type: "string", enum: [...FUNNEL_STAGES] },
          angle: { type: "string", enum: [...CREATIVE_ANGLES] },
          usp: {
            type: "string",
            description:
              "The specific promise this ad makes, at most 8 words. Empty string if none is stated.",
          },
          persona: {
            type: "string",
            description:
              "Who this ad is speaking to, at most 6 words. Empty string if not inferable.",
          },
        },
      },
    },
  },
} as const;

export function buildClassifyPrompt(
  items: Array<{ id: string; content: string }>,
): string {
  const body = items
    .map((i) => `--- CREATIVE ${i.id} ---\n${i.content}`)
    .join("\n\n");

  return [
    "Classify each ad creative below into the fixed taxonomy.",
    "",
    "Rules:",
    "- Use ONLY the allowed values. Never invent a label.",
    "- Judge the ad as written. Do not infer performance or quality.",
    '- When a dimension genuinely does not apply, use "other" / "unknown"',
    "  rather than forcing the nearest fit. A wrong label corrupts the",
    "  aggregate more than an honest unknown.",
    "- usp: the specific promise, at most 8 words, in the ad's own wording",
    "  where possible. Empty string if the ad makes no concrete promise.",
    "- persona: who it addresses, at most 6 words. Empty string if unclear.",
    "- Return exactly one result per creative, echoing the given id.",
    "",
    "Funnel stages:",
    "- TOFU: awareness. Broad, problem-aware, no purchase ask.",
    "- MOFU: consideration. Comparison, proof, education, lead capture.",
    "- BOFU: conversion. Direct purchase ask, offer, retargeting language.",
    "",
    body,
  ].join("\n");
}

/**
 * Coerce a model result into a valid CreativeTags, falling back rather than
 * throwing. The schema enum makes bad values unlikely; this is the belt to
 * that braces, because one unparseable row must not fail a 40-creative batch.
 */
export function coerceTags(raw: unknown): CreativeTags {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pick = <T extends readonly string[]>(
    value: unknown,
    allowed: T,
    fallback: T[number],
  ): T[number] =>
    typeof value === "string" && (allowed as readonly string[]).includes(value)
      ? (value as T[number])
      : fallback;

  const text = (v: unknown, maxWords: number): string => {
    if (typeof v !== "string") return "";
    return v.trim().split(/\s+/).slice(0, maxWords).join(" ");
  };

  return {
    hookType: pick(r.hookType, HOOK_TYPES, "other"),
    funnelStage: pick(r.funnelStage, FUNNEL_STAGES, "unknown"),
    angle: pick(r.angle, CREATIVE_ANGLES, "other"),
    usp: text(r.usp, 8),
    persona: text(r.persona, 6),
    taxonomyVersion: TAXONOMY_VERSION,
  };
}
