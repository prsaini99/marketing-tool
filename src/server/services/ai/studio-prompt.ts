/**
 * Pure prompt assembly for the Ad Studio image generator. Turns a brief,
 * optional brand kit, toggle state, chosen format layout, literal copy, and
 * the roles of any reference images into the final text prompt sent to the
 * OpenAI images API.
 *
 * Imports NOTHING, by design — same shape as automation/lead.ts, flags.ts
 * and repetition.ts: a pure function over plain data, testable with zero
 * setup and tunable without touching API plumbing.
 *
 * Built as a list of optional labelled sections joined by blank lines with
 * empties filtered out — the same "omit when off" shape buildSystemPrompt
 * (ai-guards.ts) uses, applied per-section instead of per-line so the model
 * sees a structured brief rather than one paragraph.
 *
 * Three deliberate choices carry most of the quality gain here, all
 * documented in OpenAI's own image-model prompting guide: literal copy is
 * quoted (the fix for garbled on-image text — a quoted string reads as
 * characters to reproduce, not a description to interpret), typography is
 * stated as explicit levels (the fix for everything rendering at one size),
 * and exclusions are stated outright rather than left implied.
 */

/**
 * What a reference image IS, which decides how the prompt describes it.
 *
 * "proof" exists because the formats that require real evidence — before /
 * after, quote card, review stack, founder quote — had no honest role to sit
 * in. Tagging a founder selfie "product" told the model to reproduce "the
 * item being sold", which is the opposite of leaving a real person alone.
 */
export type ReferenceRole = "product" | "proof" | "style" | "logo";

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

/** The exact strings to render into the image. Empty slots are omitted. */
export interface StudioCopy {
  headline?: string;
  subhead?: string;
  offer?: string;
  cta?: string;
  proof?: string;
  attribution?: string;
  source?: string;
}

export interface StudioPromptInput {
  brief: string;
  brand: StudioBrand | null;
  toggles: StudioToggles;
  roles: ReferenceRole[];
  /** The chosen format's frame instruction. Omitted for a free-form brief. */
  layout?: string;
  /** Copy written by the copy stage, rendered literally. */
  copy?: StudioCopy;
  /**
   * How this run should look, drawn fresh each generation. The layout fixes
   * what sits where; without this the model falls back on its own house
   * style, so two runs of one format came back as recognisably the same ad.
   */
  artDirection?: string;
}

// The OpenAI images edit endpoint accepts a bounded set of reference
// images per call. This counts every reference passed in total — the
// product photo and the logo included — not four in addition to them.
export const MAX_REFERENCES = 4;

const ROLE_INSTRUCTIONS: Record<ReferenceRole, string> = {
  product:
    "A product reference image is attached. Reproduce the product shown recognisably — same shape, colours, and details.",
  proof:
    "A proof reference image is attached: a real customer, a real founder, or a real result. Reproduce the person or the result faithfully and honestly — same face, same body, same outcome. Do not restage, beautify, slim, retouch, replace or idealise them, and do not substitute a model. Its truthfulness is the point of the ad.",
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

/** Slot label as the model should read it. Order is the reading order. */
const SLOT_LABELS: Array<[keyof StudioCopy, string]> = [
  ["headline", "Headline"],
  ["offer", "Offer figure"],
  ["subhead", "Supporting line"],
  ["proof", "Proof line"],
  ["attribution", "Attribution"],
  ["cta", "Call to action button"],
  ["source", "Source line"],
];

/**
 * Failures the model produces unprompted on almost every run, excluded on
 * every generation regardless of what the brand kit says. Deliberately does
 * not mention "logo" — the operator may not have supplied one, and the
 * prompt must not talk about a logo that was never given.
 */
const UNIVERSAL_EXCLUSIONS =
  "no watermark, no invented brand marks beyond the brand name given, no fake URLs or hashtags, no misspelled or gibberish text, no extra fingers or malformed hands";

export function buildStudioPrompt(input: StudioPromptInput): string {
  const { brief, brand, toggles, roles, layout, copy, artDirection } = input;

  const briefBlock = text(brief) ? `BRIEF:\n${text(brief)}` : "";

  const layoutBlock = text(layout) ? `LAYOUT:\n${text(layout)}` : "";

  // Stated after the layout and before the copy: the frame is fixed,
  // the treatment of it is not.
  const artBlock = text(artDirection) ? text(artDirection) : "";

  // Literal strings in quotes: the documented fix for garbled on-image text.
  // The model reads a quoted string as characters to reproduce rather than a
  // description to interpret.
  const copyLines = copy
    ? SLOT_LABELS.filter(([key]) => text(copy[key])).map(
        ([key, label]) => `  ${label}: "${text(copy[key])}"`,
      )
    : [];
  const copyBlock = copyLines.length
    ? `COPY — render these strings exactly as written, spelling must match:\n${copyLines.join("\n")}`
    : "";

  // Typography stated as distinct levels. Without this the model renders every
  // string at one size, which is the single most common amateur tell.
  const typographyBlock = copyLines.length
    ? "TYPOGRAPHY: set the headline in a bold condensed sans at hero scale; supporting lines at roughly a third of that size in a lighter weight; any call-to-action inside a solid pill. Clean kerning, flush left, generous spacing. Every character legible and correctly spelled."
    : "";

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

  const brandBody = [nameBlock, taglineBlock, paletteBlock, themeBlock]
    .filter(Boolean)
    .join("\n");
  const brandBlock = brandBody ? `BRAND:\n${brandBody}` : "";

  // Deliberately no `Image N —` positional label: the caller (the generate
  // route) dedupes roles down to one entry per role type but still sends
  // every reference image un-deduped, so a numeric index would go wrong the
  // moment two references share a role (e.g. two product photos collapse to
  // one "product" role but both images still go to the model). Nothing in
  // this prompt refers to an image by position, so the index isn't needed.
  const roleBlocks = roles
    .filter((role) => role !== "logo" || toggles.useLogo)
    .map((role) => `  ${ROLE_INSTRUCTIONS[role]}`);
  const referenceBlock = roleBlocks.length
    ? `REFERENCES:\n${roleBlocks.join("\n")}`
    : "";

  const avoidNotes = brand && toggles.useAvoid ? text(brand.avoidNotes) : "";
  const excludeBlock = `EXCLUDE: ${
    avoidNotes ? `${avoidNotes}. ` : ""
  }${UNIVERSAL_EXCLUSIONS}.`;

  return [
    briefBlock,
    layoutBlock,
    artBlock,
    copyBlock,
    typographyBlock,
    brandBlock,
    referenceBlock,
    excludeBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
}
