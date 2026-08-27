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
}

export interface StudioToggles {
  useColours: boolean;
  useTheme: boolean;
  useLogo: boolean;
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

  const themeBlock =
    toggles.useTheme && brand && brand.themeNotes
      ? `Brand theme notes: ${brand.themeNotes}`
      : "";

  const roleBlocks = roles
    .filter((role) => role !== "logo" || toggles.useLogo)
    .map((role) => ROLE_INSTRUCTIONS[role]);

  return [brief, paletteBlock, themeBlock, ...roleBlocks]
    .filter(Boolean)
    .join("\n");
}
