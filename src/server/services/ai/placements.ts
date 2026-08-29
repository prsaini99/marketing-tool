/**
 * Where the ad will run, and therefore what shape it has to be.
 *
 * Framed as placements rather than raw ratios because that is how a brief
 * arrives — "this is a Stories ad" — and because the placement is what
 * decides the safe zone. Meta consolidated all four placements onto a single
 * 9:16 safe zone in March 2026, built around the tightest one (Reels): keep
 * critical elements clear of the top 14%, the bottom 20-35%, and 6% of each
 * side. That guidance is worth giving the image model only for the vertical
 * placement, where it actually bites.
 *
 * Imports NOTHING, same discipline as ad-formats.ts and studio-prompt.ts.
 *
 * The size split is a real model capability difference, not a preference.
 * gpt-image-2 accepts arbitrary WIDTHxHEIGHT as long as both are divisible
 * by 16 and the ratio is between 1:3 and 3:1, so it can hit 4:5 and 9:16
 * exactly. Every other GPT image model accepts only 1024x1024, 1024x1536
 * and 1536x1024 — so a portrait ad on those models comes out 2:3, which is
 * close to 4:5 and noticeably taller than 9:16 wants. `exactOn` names the
 * models that can render the true ratio.
 */

export type PlacementId = "feed-square" | "feed-portrait" | "story";

export interface Placement {
  id: PlacementId;
  /** Named for where it runs. */
  label: string;
  /** Shown beside the label. */
  ratio: string;
  /** What Meta actually wants, for the operator's reference. */
  metaPixels: string;
  /** Size string for a model that supports arbitrary resolutions. */
  exactSize: string;
  /** Nearest standard size for models that do not. */
  fallbackSize: string;
  /** True when fallbackSize is the same shape as exactSize. */
  fallbackIsExact: boolean;
  /** Prompt fragment describing the frame and any safe zone. */
  promptNote: string;
}

/**
 * Models that accept arbitrary WIDTHxHEIGHT. Kept as a list rather than a
 * single id because the family will grow, and because a wrong guess here
 * costs a 400 mid-generation rather than a graceful fallback.
 */
export const ARBITRARY_SIZE_MODELS = ["gpt-image-2"];

export function supportsExactRatio(model: string): boolean {
  return ARBITRARY_SIZE_MODELS.includes(model.trim());
}

export const PLACEMENTS: Placement[] = [
  {
    id: "feed-square",
    label: "Feed — square",
    ratio: "1:1",
    metaPixels: "1080 × 1080",
    exactSize: "1024x1024",
    fallbackSize: "1024x1024",
    fallbackIsExact: true,
    promptNote:
      "Square 1:1 frame. Keep every critical element well inside the edges — Meta crops the outer margin on some placements.",
  },
  {
    id: "feed-portrait",
    label: "Feed — portrait",
    ratio: "4:5",
    metaPixels: "1080 × 1350",
    // 1024/16 = 64, 1280/16 = 80, and 1024/1280 is exactly 0.8.
    exactSize: "1024x1280",
    fallbackSize: "1024x1536",
    fallbackIsExact: false,
    promptNote:
      "Vertical 4:5 frame — taller than wide, claiming more of a phone screen than a square. Compose for the extra height rather than centring a square design in it.",
  },
  {
    id: "story",
    label: "Stories & Reels",
    ratio: "9:16",
    metaPixels: "1080 × 1920",
    // 1152/16 = 72, 2048/16 = 128, and 1152/2048 is exactly 0.5625.
    exactSize: "1152x2048",
    fallbackSize: "1024x1536",
    fallbackIsExact: false,
    promptNote:
      "Full-height vertical 9:16 frame. Keep all text and any critical element out of the top 14% and the bottom 20-35% of the frame, and 6% in from each side — Meta overlays its own interface there and anything in those bands is covered or cropped.",
  },
];

export function getPlacement(id: string): Placement | null {
  return PLACEMENTS.find((p) => p.id === id) ?? null;
}

/**
 * The size to request, and whether it is the true ratio. A caller that gets
 * `exact: false` should say so rather than quietly shipping a different
 * shape than the operator picked.
 */
export function resolveSize(
  placement: Placement,
  model: string,
): { size: string; exact: boolean } {
  if (supportsExactRatio(model)) {
    return { size: placement.exactSize, exact: true };
  }
  return {
    size: placement.fallbackSize,
    exact: placement.fallbackIsExact,
  };
}
