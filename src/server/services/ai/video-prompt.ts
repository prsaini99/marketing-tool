/**
 * Pure prompt assembly for video generation. Turns a brief, a format's scene,
 * a GPT-written shot and the brand's visual fields into the text sent to
 * Kling, plus the separate negative prompt Kling accepts.
 *
 * Imports NOTHING — same discipline as studio-prompt.ts.
 *
 * Two deliberate differences from the still path:
 *
 * 1. No copy, ever. brandName and tagline are not accepted here. Diffusion
 *    video renders text unreliably and a misspelled headline burned into a
 *    clip cannot be fixed without regenerating; ad copy belongs in Meta's own
 *    text fields for video.
 * 2. A real negative prompt. On the still path prohibitions are smuggled into
 *    the prompt and hoped for; Kling takes them as a parameter.
 */

/** Kling v2.1 Master rejects a prompt longer than this. */
export const MAX_VIDEO_PROMPT = 2500;

export interface VideoBrand {
  palette: string[];
  themeNotes: string | null;
  brandName: string | null;
  tagline: string | null;
  avoidNotes: string | null;
}

export interface VideoToggles {
  useColours: boolean;
  useTheme: boolean;
  useLogo: boolean;
  useIdentity: boolean;
  useAvoid: boolean;
}

/** Written by the GPT stage. Temporal, unlike an image prompt. */
export interface VideoShot {
  subject: string;
  action: string;
  camera: string;
  setting: string;
}

export interface VideoPromptInput {
  brief: string;
  /** The format's scene fragment. */
  scene: string;
  brand: VideoBrand | null;
  toggles: VideoToggles;
  artDirection?: string;
  shot?: VideoShot;
}

/**
 * Failures video models produce unprompted on almost every run. Text is on
 * this list because we never ask for any — anything textual in frame is an
 * artefact.
 */
const UNIVERSAL_NEGATIVE =
  "text, lettering, captions, subtitles, watermark, logo artefacts, distorted faces, deformed hands, extra limbs, morphing objects, flickering, jitter";

function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Cut at the last sentence end that fits, so the model gets whole sentences. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastStop = cut.lastIndexOf(".");
  return lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : cut;
}

export function buildVideoPrompt(input: VideoPromptInput): string {
  const { brief, scene, brand, toggles, artDirection, shot } = input;

  const shotBlock = shot
    ? (
        [
          ["Subject", shot.subject],
          ["Action", shot.action],
          ["Camera", shot.camera],
          ["Setting", shot.setting],
        ] as const
      )
        // Emptiness is checked on the value, not on how the line happens to
        // render — a field whose own text ends in ": " is not empty.
        .filter(([, value]) => text(value))
        .map(([label, value]) => `${label}: ${text(value)}`)
        .join(" ")
    : "";

  const palette =
    toggles.useColours && brand && brand.palette.length > 0
      ? `Colour palette, dominant first: ${brand.palette.join(", ")}.`
      : "";

  const themeNotes = brand && toggles.useTheme ? text(brand.themeNotes) : "";
  const theme = themeNotes ? `Mood: ${themeNotes}.` : "";

  const parts = [
    text(scene),
    shotBlock,
    text(brief) ? `Brief: ${text(brief)}` : "",
    text(artDirection),
    palette,
    theme,
    "Five seconds, one continuous shot, no cuts.",
  ].filter(Boolean);

  return truncate(parts.join(" "), MAX_VIDEO_PROMPT);
}

export function buildNegativePrompt(
  brand: VideoBrand | null,
  toggles: VideoToggles,
): string {
  const avoid = brand && toggles.useAvoid ? text(brand.avoidNotes) : "";
  return [avoid, UNIVERSAL_NEGATIVE].filter(Boolean).join(", ");
}
