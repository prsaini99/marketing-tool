/**
 * Single source of truth for the ad-preview placements the app supports.
 *
 * The API route uses this to validate `formats=` query params, and the
 * preview modal uses it to label cards + populate the placement dropdown.
 * Keep both in lockstep — adding a new placement here lights it up
 * everywhere.
 */

export interface AdPlacement {
  format: string; // Meta `ad_format` value
  label: string; // What to show in the UI
}

export const AD_PLACEMENTS: AdPlacement[] = [
  { format: "MOBILE_FEED_STANDARD", label: "Facebook Feed" },
  { format: "INSTAGRAM_STANDARD", label: "Instagram Feed" },
  { format: "INSTAGRAM_STORY", label: "Instagram Story" },
  { format: "INSTAGRAM_REELS", label: "Instagram Reels" },
  { format: "RIGHT_COLUMN_STANDARD", label: "Facebook Right Column" },
];

// The placement we load on first open — keeps the default cost to 1 call.
export const DEFAULT_PLACEMENT_FORMAT = "MOBILE_FEED_STANDARD";

export const AD_PLACEMENT_FORMATS = AD_PLACEMENTS.map((p) => p.format);

export function getPlacementLabel(format: string): string {
  return AD_PLACEMENTS.find((p) => p.format === format)?.label ?? format;
}
