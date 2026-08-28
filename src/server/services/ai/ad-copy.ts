/**
 * Stage one of generation: turn a format, an optional brief and the brand kit
 * into the exact strings the image will render.
 *
 * Copy is written BEFORE the image on purpose. Quoting exact strings into an
 * image prompt is the documented fix for garbled on-image text, and deciding
 * the angle first is what stops an empty brief producing a generic render.
 *
 * The hard rule is that this stage may not invent facts. A model asked for an
 * offer line will produce "FLAT 50% OFF" whether or not a discount exists in
 * its inputs; findFabricated (copy-guard.ts) catches that before it reaches an
 * image a client publishes.
 */

import { completeJson } from "@/lib/llm/chat";
import { findFabricated } from "@/server/services/ai/copy-guard";
import type { AdFormat, CopySlot } from "@/server/services/ai/ad-formats";
import type { StudioBrand, StudioCopy } from "@/server/services/ai/studio-prompt";

export interface AdCopy extends StudioCopy {
  /** Why this ad should land. Shown to the operator, never drawn. */
  angle: string;
  /**
   * Slots dropped because their figure still failed the fabrication guard
   * after the retry. Surfaced to the operator rather than silently deleted:
   * stat-drop and offer-stack are one-click formats DEFINED by a figure, so
   * on an empty brief with a figure-less brand kit the hero slot is always
   * stripped and the result is a statistic-free "stat drop" with no reason
   * given. Empty on a clean run.
   */
  droppedSlots: string[];
}

/**
 * The copy stage runs before the image, so a hung text call costs the
 * operator the whole click — the route would sit until maxDuration = 120 and
 * never attempt the image at all. completeJson takes no AbortSignal and its
 * signature is shared with other callers, so the bound is applied here.
 * A timeout throws, and writeAdCopy's caller turns any throw into copyError
 * and generates from the brief alone.
 */
const COPY_TIMEOUT_MS = 15_000;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${COPY_TIMEOUT_MS}ms`)),
      COPY_TIMEOUT_MS,
    );
  });
  return Promise.race([work, bound]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

const SLOT_GUIDANCE: Record<CopySlot, string> = {
  headline: "five to eight words, the single strongest thing you can say",
  subhead: "one short supporting line, no more than twelve words",
  offer: "the offer exactly as stated in the inputs — omit entirely if none is given",
  cta: "two to four words, an action",
  proof: "a concrete outcome or result taken only from the inputs",
  attribution: "who said it, as given in the inputs",
  source: "where a figure came from, as given in the inputs",
};

function buildSystemPrompt(format: AdFormat): string {
  const slots = format.slots
    .map((s) => `- ${s}: ${SLOT_GUIDANCE[s]}`)
    .join("\n");
  return [
    "You write the on-image copy for a single social ad creative. Your output is rendered directly onto the image, so every string must be final.",
    `The ad uses the "${format.name}" format. Its structure: ${format.anatomy}`,
    `Fill exactly these slots:\n${slots}`,
    "RULES:",
    "- Use ONLY facts present in the brief or brand details supplied. Never invent a discount, price, percentage, statistic, review count, customer name, award or date.",
    "- If a slot has no supporting fact in the inputs, omit that slot entirely rather than inventing something to fill it.",
    "- No claims the supplied material cannot support.",
    "- Write the strings exactly as they should appear, including capitalisation.",
    "- Also return `angle`: one sentence naming who this ad is for and why it should land. This is internal and is never drawn on the image.",
  ].join("\n\n");
}

const SCHEMA = {
  name: "ad_copy",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      angle: { type: "string" },
      headline: { type: ["string", "null"] },
      subhead: { type: ["string", "null"] },
      offer: { type: ["string", "null"] },
      cta: { type: ["string", "null"] },
      proof: { type: ["string", "null"] },
      attribution: { type: ["string", "null"] },
      source: { type: ["string", "null"] },
    },
    required: [
      "angle", "headline", "subhead", "offer",
      "cta", "proof", "attribution", "source",
    ],
  },
} as const;

/** Strings the copy may draw figures from. Anything else is fabrication. */
function sourceStrings(brief: string, brand: StudioBrand | null): string[] {
  return [
    brief,
    brand?.themeNotes ?? "",
    brand?.brandName ?? "",
    brand?.tagline ?? "",
  ].filter(Boolean);
}

function toCopy(raw: Record<string, unknown>, slots: CopySlot[]): AdCopy {
  const pick = (k: string) => {
    const v = raw[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const out: AdCopy = { angle: pick("angle") ?? "", droppedSlots: [] };
  for (const slot of slots) {
    const v = pick(slot);
    if (v) (out as unknown as Record<string, unknown>)[slot] = v;
  }
  return out;
}

export async function writeAdCopy(args: {
  format: AdFormat;
  brief: string;
  brand: StudioBrand | null;
}): Promise<AdCopy> {
  const { format, brief, brand } = args;

  const userParts = [
    brief.trim()
      ? `BRIEF: ${brief.trim()}`
      : `NO BRIEF SUPPLIED. Write for this angle: ${format.defaultAngle}`,
    brand?.brandName ? `BRAND NAME: ${brand.brandName}` : "",
    brand?.tagline ? `TAGLINE: ${brand.tagline}` : "",
    brand?.themeNotes ? `BRAND NOTES: ${brand.themeNotes}` : "",
  ].filter(Boolean);

  const raw = await withTimeout(
    completeJson<Record<string, unknown>>(
      userParts.join("\n"),
      { model: "gpt-4o-mini", system: buildSystemPrompt(format), temperature: 0.8 },
      SCHEMA,
    ),
    "copy stage",
  );

  const copy = toCopy(raw, format.slots);

  // One retry with the offending figures named, then drop the bad slots. A
  // second model call is cheaper than shipping an invented discount, and
  // dropping a slot is always safe — buildStudioPrompt omits absent slots.
  const sources = sourceStrings(brief, brand);
  const drawn = format.slots
    .map((s) => (copy as unknown as Record<string, unknown>)[s])
    .filter((v): v is string => typeof v === "string");
  const bad = findFabricated(drawn, sources);
  if (bad.length === 0) return copy;

  const retryRaw = await withTimeout(
    completeJson<Record<string, unknown>>(
      [
        ...userParts,
        `You previously invented these figures, which appear nowhere in the inputs: ${bad.join(", ")}. Rewrite without them. Omit any slot you cannot fill from the inputs.`,
      ].join("\n"),
      { model: "gpt-4o-mini", system: buildSystemPrompt(format), temperature: 0.4 },
      SCHEMA,
    ),
    "copy stage retry",
  );
  const retry = toCopy(retryRaw, format.slots);

  const retryDrawn = format.slots
    .map((s) => (retry as unknown as Record<string, unknown>)[s])
    .filter((v): v is string => typeof v === "string");
  const stillBad = findFabricated(retryDrawn, sources);
  if (stillBad.length === 0) return retry;

  // Second failure: strip every slot that still carries an invented figure
  // rather than refusing the whole generation — and record which, so the
  // operator is told the statistic is missing instead of quietly shipping a
  // stat drop with no statistic in it.
  for (const slot of format.slots) {
    const value = (retry as unknown as Record<string, unknown>)[slot];
    if (typeof value === "string" && findFabricated([value], sources).length) {
      delete (retry as unknown as Record<string, unknown>)[slot];
      retry.droppedSlots.push(slot);
    }
  }
  return retry;
}
