/**
 * Writes the shot a video should contain: who or what is on screen, what
 * happens, how the camera moves, and where. A video prompt is temporal in a
 * way an image prompt is not, and asking a diffusion model for "an ad" gives
 * you stock footage.
 *
 * Follows ad-copy.ts: gpt-4o-mini, a strict schema, a hard timeout, and the
 * rule that it may not invent facts.
 *
 * Deliberately NOT run through findFabricated: a shot description carries no
 * figures to fabricate. The copy that does carry them is written by the copy
 * stage, which is already guarded.
 */

import { completeJson } from "@/lib/llm/chat";
import type { VideoFormat } from "@/server/services/ai/video-formats";
import type { VideoBrand, VideoShot } from "@/server/services/ai/video-prompt";
import type { BrandContext } from "@/server/services/ai/ad-copy";

const SHOT_TIMEOUT_MS = 15_000;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${SHOT_TIMEOUT_MS}ms`)),
      SHOT_TIMEOUT_MS,
    );
  });
  return Promise.race([work, bound]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

const SCHEMA = {
  name: "video_shot",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      angle: { type: "string" },
      subject: { type: "string" },
      action: { type: "string" },
      camera: { type: "string" },
      setting: { type: "string" },
    },
    required: ["angle", "subject", "action", "camera", "setting"],
  },
} as const;

function systemPrompt(format: VideoFormat): string {
  return [
    "You describe the single shot a five-second video advertisement should contain. Your words are sent to a video generation model, so describe what is visible and what moves — never abstractions, never marketing language.",
    `The ad uses the "${format.name}" format: ${format.anatomy}`,
    `Its scene direction: ${format.scene}`,
    "Return four fields:",
    "- subject: who or what is on screen, concretely",
    "- action: what happens across the five seconds, as one continuous movement",
    "- camera: how the camera behaves — a single move, or locked off",
    "- setting: where this is, described physically",
    "RULES:",
    "- Use only facts present in the brief or brand details supplied. Never invent a product, a claim, a statistic or a price.",
    "- Never describe text, captions, logos or writing appearing in the frame. None will be rendered.",
    "- One continuous shot. No cuts, no montage, no split screen.",
    "- Also return `angle`: one sentence on who this is for and why it lands. Internal, never shown in the video.",
  ].join("\n\n");
}

export async function writeVideoShot(args: {
  format: VideoFormat;
  brief: string;
  brand: VideoBrand | null;
  context?: BrandContext | null;
}): Promise<{ shot: VideoShot; angle: string }> {
  const { format, brief, brand } = args;
  const context = args.context ?? null;

  const user = [
    brief.trim()
      ? `BRIEF: ${brief.trim()}`
      : `NO BRIEF SUPPLIED. Work from the format and the brand details below.`,
    brand?.themeNotes ? `BRAND NOTES: ${brand.themeNotes}` : "",
    context?.description ? `WHAT THE BUSINESS DOES: ${context.description}` : "",
    context?.audience ? `WHO IT IS FOR: ${context.audience}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await withTimeout(
    completeJson<Record<string, unknown>>(
      user,
      { model: "gpt-4o-mini", system: systemPrompt(format), temperature: 0.8 },
      SCHEMA,
    ),
    "video shot",
  );

  const str = (k: string) => {
    const v = raw[k];
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    angle: str("angle"),
    shot: {
      subject: str("subject"),
      action: str("action"),
      camera: str("camera"),
      setting: str("setting"),
    },
  };
}
