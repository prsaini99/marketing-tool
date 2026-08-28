/**
 * What makes two runs of the same format look different.
 *
 * A format fixes the skeleton — what sits where in the frame — and that is
 * the point of picking one. But the skeleton is all it fixes, and with
 * nothing else varying, Offer Stack generated on Monday and on Tuesday came
 * back as recognisably the same ad. The layout is supposed to be the
 * constant; the art direction is supposed to be the variable, and it was
 * simply never stated, so the model fell back on its own house style every
 * time.
 *
 * Each generation therefore draws one of these and states it in the prompt.
 *
 * Imports NOTHING, same discipline as ad-formats.ts and placements.ts. The
 * randomness lives in the caller: this module only maps an index to a
 * direction, so it stays pure and the choice stays testable.
 */

/**
 * The register a format is built in. A founder selfie cannot be shot as a
 * flat graphic, and an offer stack is not a documentary photograph, so a
 * direction is only offered to formats it can actually serve.
 */
export type FormatLook = "designed" | "photographic" | "raw";

export interface ArtDirection {
  id: string;
  /** Shown to the operator so they can see why two runs differ. */
  label: string;
  /** The prompt fragment. */
  direction: string;
  suits: FormatLook[];
}

export const ART_DIRECTIONS: ArtDirection[] = [
  // ── Designed: the frame is a graphic composition ────────────────────
  {
    id: "editorial-print",
    label: "Editorial print",
    direction:
      "Art direction: editorial print. Generous white space, one strong typographic hierarchy carrying the whole composition, a restrained two-colour palette, the balance of a magazine spread rather than a poster.",
    suits: ["designed"],
  },
  {
    id: "flat-graphic",
    label: "Bold flat graphic",
    direction:
      "Art direction: bold flat graphic. Large geometric shapes and hard-edged colour blocking, no gradients and no soft shadows, forms reading clearly at thumbnail size.",
    suits: ["designed"],
  },
  {
    id: "premium-minimal",
    label: "Premium minimal",
    direction:
      "Art direction: premium minimal. A deep single-colour ground, one hero element, small precise type set with wide letter-spacing, and a great deal of deliberate empty space.",
    suits: ["designed"],
  },
  {
    id: "layered-collage",
    label: "Layered collage",
    direction:
      "Art direction: layered collage. Overlapping shapes and photographic cut-outs with visible torn or hard edges, a textured paper ground, elements sitting at slight angles to each other.",
    suits: ["designed"],
  },
  // ── Photographic: a real photograph carries the frame ───────────────
  {
    id: "studio-seamless",
    label: "Studio product",
    direction:
      "Art direction: studio product photography. A seamless paper backdrop, one controlled key light with a soft fill, a crisp contact shadow beneath the subject, colour-accurate and clean.",
    suits: ["photographic", "designed"],
  },
  {
    id: "lifestyle-window",
    label: "Lifestyle, window light",
    direction:
      "Art direction: editorial lifestyle. A real interior, natural light from a single window to one side, shallow depth of field, the product in genuine use rather than displayed.",
    suits: ["photographic"],
  },
  {
    id: "golden-hour",
    label: "Golden hour",
    direction:
      "Art direction: golden-hour outdoor. Low warm sun, long directional shadows, a touch of atmospheric haze, shot on a fast prime with the background falling away.",
    suits: ["photographic"],
  },
  {
    id: "flat-lay",
    label: "Overhead flat lay",
    direction:
      "Art direction: overhead flat lay. Shot straight down on a textured surface, supporting props arranged with deliberate negative space between them, even diffused light and soft shadows.",
    suits: ["photographic"],
  },
  // ── Raw: the point is that it does not look art-directed ────────────
  {
    id: "phone-snapshot",
    label: "Phone snapshot",
    direction:
      "Art direction: phone snapshot. Handheld and slightly off-level, available light only, ordinary framing, no retouching and no styling — it should look taken rather than made.",
    suits: ["raw"],
  },
  {
    id: "documentary-candid",
    label: "Documentary candid",
    direction:
      "Art direction: documentary candid. Caught mid-motion, focus not quite perfect, a real environment with its own untidiness left in frame.",
    suits: ["raw"],
  },
  {
    id: "direct-flash",
    label: "Direct flash",
    direction:
      "Art direction: direct on-camera flash. Hard frontal light, a deep shadow thrown behind the subject, slightly blown highlights — the look of a late-night snapshot.",
    suits: ["raw"],
  },
  {
    id: "screenshot-plain",
    label: "Plain capture",
    direction:
      "Art direction: plain and uncomposed. Flat even light, dead-on angle, no styling or design treatment whatsoever, as though captured rather than produced.",
    suits: ["raw"],
  },
];

/** Every direction a format's look can legitimately be shot in. */
export function directionsFor(look: FormatLook): ArtDirection[] {
  return ART_DIRECTIONS.filter((d) => d.suits.includes(look));
}

/**
 * Maps an arbitrary index onto one of the directions available to this look,
 * wrapping so any integer is valid. The caller supplies the index — usually
 * random per generation — which keeps this module pure and the mapping
 * testable while the variation stays genuinely varied.
 */
export function artDirectionFor(look: FormatLook, index: number): ArtDirection {
  const pool = directionsFor(look);
  const i = ((Math.trunc(index) % pool.length) + pool.length) % pool.length;
  return pool[i];
}
