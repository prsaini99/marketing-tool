/**
 * Pure prompt assembly for the Ad Studio image generator. Turns a brief,
 * optional brand kit, toggle state, and the roles of any reference images
 * into the final text prompt sent to the OpenAI images API.
 *
 * Imports NOTHING, by design — same shape as automation/lead.ts, flags.ts
 * and repetition.ts: a pure function over plain data, testable with zero
 * setup and tunable without touching API plumbing.
 *
 * Built as a list of optional fragments joined by newlines with empties
 * filtered out, the same shape buildSystemPrompt (ai-guards.ts) uses — it
 * makes "omit when off" trivially correct instead of a string-surgery
 * afterthought.
 */

export type ReferenceRole = "product" | "style" | "logo";

export interface StudioBrand {
  palette: string[];
  themeNotes: string | null;
  /** Rendered as literal on-image text, so the model stops inventing one. */
  brandName: string | null;
  tagline: string | null;
  /** Fed in as a prohibition, not a subject. */
  avoidNotes: string | null;
}

export interface StudioToggles {
  useColours: boolean;
  useTheme: boolean;
  useLogo: boolean;
  /** Brand name and tagline travel together — they are one piece of copy. */
  useIdentity: boolean;
  useAvoid: boolean;
}

// The OpenAI images edit endpoint accepts a bounded set of reference
// images per call. This counts every reference passed in total — the
// product photo and the logo included — not four in addition to them.
export const MAX_REFERENCES = 4;

const ROLE_INSTRUCTIONS: Record<ReferenceRole, string> = {
  product:
    "A product reference image is attached. Reproduce the product shown recognisably — same shape, colours, and details.",
  style:
    "A style reference image is attached. Match its overall mood and aesthetic (lighting, composition, colour grading) without copying its subject.",
  logo:
    "A brand mark reference image is attached. Incorporate the logo shown, placed naturally and legibly in the scene.",
};

/**
 * Every optional field is trimmed before it is tested for presence, so a
 * field the operator cleared to spaces reads as absent rather than
 * producing a fragment with nothing after the colon.
 */
function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function buildStudioPrompt(
  brief: string,
  brand: StudioBrand | null,
  toggles: StudioToggles,
  roles: ReferenceRole[],
): string {
  const paletteBlock =
    toggles.useColours && brand && brand.palette.length > 0
      ? `Use this colour palette, primary colour first: ${brand.palette.join(", ")}.`
      : "";

  const themeNotes = brand && toggles.useTheme ? text(brand.themeNotes) : "";
  const themeBlock = themeNotes ? `Brand theme notes: ${themeNotes}` : "";

  const brandName = brand && toggles.useIdentity ? text(brand.brandName) : "";
  const nameBlock = brandName
    ? `Render the brand name exactly as written, as on-image text: "${brandName}". Do not alter its spelling or invent a different name.`
    : "";

  const tagline = brand && toggles.useIdentity ? text(brand.tagline) : "";
  const taglineBlock = tagline
    ? `Include this tagline as secondary on-image text, exactly as written: "${tagline}".`
    : "";

  const avoidNotes = brand && toggles.useAvoid ? text(brand.avoidNotes) : "";
  const avoidBlock = avoidNotes
    ? `Do not include any of the following: ${avoidNotes}.`
    : "";

  const roleBlocks = roles
    .filter((role) => role !== "logo" || toggles.useLogo)
    .map((role) => ROLE_INSTRUCTIONS[role]);

  return [
    brief,
    nameBlock,
    taglineBlock,
    paletteBlock,
    themeBlock,
    ...roleBlocks,
    // Last, because a prohibition is easiest to follow when the model has
    // already read everything it is being asked to produce.
    avoidBlock,
  ]
    .filter(Boolean)
    .join("\n");
}
