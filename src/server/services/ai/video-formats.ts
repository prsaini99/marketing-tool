/**
 * Video ad formats — the shapes that carry the feed, from the same research
 * that produced the static catalogue.
 *
 * These are NOT the seventeen static formats. Those describe still-frame
 * anatomy ("headline top-left, product hero right"), which is not a thing a
 * five-second clip has. A video format describes what happens over time.
 *
 * Imports NOTHING, same discipline as ad-formats.ts and placements.ts.
 *
 * No format asks for on-screen text: diffusion video renders text far less
 * reliably than the image models, and a misspelled headline burned into a
 * clip cannot be fixed without regenerating. Ad copy goes in Meta's own text
 * fields, which is where video ad copy belongs.
 */

export type VideoIntent = "awareness" | "consideration" | "conversion";

/** Mirrors FormatLook in art-directions.ts; declared here to stay import-free. */
export type VideoLook = "designed" | "photographic" | "raw";

export interface VideoFormat {
  id: string;
  name: string;
  intent: VideoIntent;
  look: VideoLook;
  /** What happens across the clip, written for the video model. */
  scene: string;
  /** One line for the operator. */
  anatomy: string;
  briefExample: string;
  failureMode: string;
}

export const VIDEO_FORMATS: VideoFormat[] = [
  {
    id: "problem-hook",
    name: "Problem hook",
    intent: "awareness",
    look: "photographic",
    scene:
      "Open on the moment the problem bites — the frustration visible in one clear action. Hold it long enough to be recognised, then resolve to the product solving it. One continuous shot, slow push in.",
    anatomy: "Opens on the pain, holds it, resolves to the product.",
    briefExample: "Oil that smokes up the kitchen every single time you fry",
    failureMode: "A generic frustration. Show the specific moment it goes wrong.",
  },
  {
    id: "transformation",
    name: "Transformation",
    intent: "consideration",
    look: "photographic",
    scene:
      "A single continuous take showing a change taking place — the before state, the moment of change, the after. No cuts, no split screen; the camera holds steady while the subject changes.",
    anatomy: "Before, the change, after — one continuous take.",
    briefExample: "Dull brass handle coming up bright as it is polished",
    failureMode: "Cutting between two shots. The change has to be seen happening.",
  },
  {
    id: "product-demo",
    name: "Product demo",
    intent: "consideration",
    look: "photographic",
    scene:
      "The product in genuine use, filmed close enough to show the mechanism rather than the claim. Hands in frame, real surfaces, one deliberate camera move that follows the action.",
    anatomy: "The product working, close enough to show how.",
    briefExample: "The press squeezing oil from groundnuts, close on the spout",
    failureMode: "A product turning on a plinth. Show it doing its job.",
  },
  {
    id: "founder-story",
    name: "Founder story",
    intent: "awareness",
    look: "raw",
    scene:
      "One person talking directly to camera in the real place they work, filmed handheld at a natural distance. Available light, background left as it is, no studio staging.",
    anatomy: "A person talking to camera in a real place.",
    briefExample: "The founder in her workshop explaining why she started",
    failureMode: "A studio setup. The point is that it looks unproduced.",
  },
  {
    id: "ugc-testimonial",
    name: "UGC testimonial",
    intent: "consideration",
    look: "raw",
    scene:
      "Filmed as though on a phone by the person speaking — held at arm's length, slightly off-level, ordinary room, available light. They are talking to the camera about their own experience.",
    anatomy: "Handheld, unstyled, one person's own experience.",
    briefExample: "A customer at her kitchen counter talking about the oil",
    failureMode: "Anything that looks lit or framed by a professional.",
  },
];

export function getVideoFormat(id: string): VideoFormat | null {
  return VIDEO_FORMATS.find((f) => f.id === id) ?? null;
}

/**
 * The studio's placement, mapped onto the aspect ratios Kling offers.
 *
 * No text-to-video model offers 4:5 — the options across every model are
 * 16:9, 9:16, 4:3, 3:4, 1:1 and 21:9. Feed-portrait therefore becomes square
 * and says so, rather than silently shipping 3:4 and letting the operator
 * discover the shape changed.
 */
export function aspectForPlacement(placementId: string): {
  aspectRatio: "1:1" | "9:16";
  note: string | null;
} {
  if (placementId === "story") return { aspectRatio: "9:16", note: null };
  if (placementId === "feed-portrait") {
    return {
      aspectRatio: "1:1",
      note: "Video has no 4:5 — this will be square.",
    };
  }
  return { aspectRatio: "1:1", note: null };
}
