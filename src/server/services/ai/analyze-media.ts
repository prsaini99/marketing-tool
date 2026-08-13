/**
 * Media analysis — give the creative classifier eyes and ears.
 *
 * The hook/angle classifier reads TEXT. For a video ad that text is the
 * caption, and a video's real hook usually lives in the footage — so
 * classifying video ads by caption alone mislabels exactly the creatives
 * that matter most. This service closes most of that gap without touching
 * the footage itself:
 *
 *   videos → Whisper TRANSCRIPT of the audio track. In direct-response ads
 *            the voiceover carries the hook ("Still doing X by hand?"), the
 *            offer and the CTA, so audio recovers most of what the caption
 *            misses at a fraction of the cost of frame analysis.
 *   images → one-paragraph VISION DESCRIPTION (gpt-4o-mini), focused on the
 *            things the taxonomy cares about: overlaid text, what's shown,
 *            the promise being made.
 *
 * Both results are CACHED on the media row (AdVideo.transcript,
 * AdImage.aiDescription): analysis runs once per asset ever, not once per
 * classification pass. null = never attempted, "" = attempted and yielded
 * nothing (a music-only video, an unreadable image) — the distinction stops
 * every pass from re-paying for assets that have nothing to say.
 *
 * DOWNLOADS ARE CDN FETCHES, NOT GRAPH CALLS. `sourceUrl`/`url` are public
 * signed *.fbcdn.net links (the same ones the browser renders), so fetching
 * them here does not breach the "Meta API only via src/lib/meta" rule — but
 * they EXPIRE in ~4 days, which is why analysis re-runs opportunistically
 * after every media sync rather than assuming old URLs still work.
 */

import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/llm/chat";
import { transcribeBuffer, MAX_TRANSCRIBE_BYTES } from "@/lib/llm/audio";

export interface MediaAnalysisResult {
  videosConsidered: number;
  videosTranscribed: number;
  videosSkipped: number;
  imagesConsidered: number;
  imagesDescribed: number;
  imagesSkipped: number;
  /** True when anything new was produced — the caller uses this to decide
      whether existing classifications are stale and need a forced re-run. */
  producedNew: boolean;
}

async function download(url: string, maxBytes: number): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.byteLength <= maxBytes ? buf : null;
  } catch {
    return null;
  }
}

const IMAGE_DESC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description", "overlaidText"],
  properties: {
    description: {
      type: "string",
      description:
        "2-3 sentences: what the image shows, its style, and what promise or feeling it communicates. Written for someone who cannot see it.",
    },
    overlaidText: {
      type: "string",
      description: "Any text rendered inside the image, verbatim. Empty if none.",
    },
  },
} as const;

/**
 * Transcribe every video in the account that has a source URL and no cached
 * transcript. Sequential and fail-soft: one dead CDN link or oversized file
 * skips that video, never the batch.
 */
export async function transcribeAccountVideos(
  adAccountId: string,
): Promise<Pick<MediaAnalysisResult, "videosConsidered" | "videosTranscribed" | "videosSkipped">> {
  const videos = await prisma.adVideo.findMany({
    where: { adAccountId, sourceUrl: { not: null }, transcript: null },
    select: { id: true, metaVideoId: true, sourceUrl: true, lengthSeconds: true },
  });

  let transcribed = 0;
  let skipped = 0;
  for (const v of videos) {
    const buf = await download(v.sourceUrl!, MAX_TRANSCRIBE_BYTES);
    if (!buf) {
      // Expired CDN URL or oversized file. transcript stays null so the next
      // run (after a fresh videos sync renews the URL) tries again.
      skipped++;
      continue;
    }
    try {
      const text = await transcribeBuffer(buf, `${v.metaVideoId}.mp4`);
      await prisma.adVideo.update({
        where: { id: v.id },
        // "" is a real result (no speech) and is cached as such.
        data: { transcript: text },
      });
      transcribed++;
    } catch (e) {
      console.error(`[analyze-media] transcribe ${v.metaVideoId} failed:`, e instanceof Error ? e.message : e);
      skipped++;
    }
  }
  return { videosConsidered: videos.length, videosTranscribed: transcribed, videosSkipped: skipped };
}

/**
 * Describe every image that backs a creative and has no cached description.
 *
 * Restricted to creative-referenced images on purpose: the image library
 * holds every upload ever, most of which back no ad; describing those would
 * spend vision calls on assets the classifier will never read.
 */
export async function describeAccountImages(
  adAccountId: string,
): Promise<Pick<MediaAnalysisResult, "imagesConsidered" | "imagesDescribed" | "imagesSkipped">> {
  const referencedHashes = (
    await prisma.adCreative.findMany({
      where: { adAccountId, imageHash: { not: null } },
      select: { imageHash: true },
    })
  ).map((c) => c.imageHash!) as string[];

  if (referencedHashes.length === 0) {
    return { imagesConsidered: 0, imagesDescribed: 0, imagesSkipped: 0 };
  }

  const images = await prisma.adImage.findMany({
    where: {
      adAccountId,
      metaImageHash: { in: referencedHashes },
      url: { not: null },
      aiDescription: null,
    },
    select: { id: true, metaImageHash: true, url: true },
  });

  let described = 0;
  let skipped = 0;
  for (const img of images) {
    // Download → base64 data URL rather than passing the CDN link through:
    // the signed URL may expire between our check and OpenAI's fetch, and a
    // data URL removes that race entirely.
    const buf = await download(img.url!, 8 * 1024 * 1024);
    if (!buf) {
      skipped++;
      continue;
    }
    try {
      const out = await completeJson<{ description?: string; overlaidText?: string }>(
        [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this ad image for someone who cannot see it. Focus on what is shown, any text rendered in the image, and what promise or feeling it communicates.",
              },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${buf.toString("base64")}` },
              },
            ],
          },
        ],
        { model: "gpt-4o-mini", temperature: 0, maxTokens: 400 },
        { name: "image_description", schema: IMAGE_DESC_SCHEMA as unknown as Record<string, unknown> },
      );
      const parts = [
        (out.description ?? "").trim(),
        (out.overlaidText ?? "").trim() ? `Text in image: "${(out.overlaidText ?? "").trim()}"` : "",
      ].filter(Boolean);
      await prisma.adImage.update({
        where: { id: img.id },
        data: { aiDescription: parts.join(" ") },
      });
      described++;
    } catch (e) {
      console.error(`[analyze-media] describe ${img.metaImageHash} failed:`, e instanceof Error ? e.message : e);
      skipped++;
    }
  }
  return { imagesConsidered: images.length, imagesDescribed: described, imagesSkipped: skipped };
}

export async function analyzeAccountMedia(
  adAccountId: string,
): Promise<MediaAnalysisResult> {
  const v = await transcribeAccountVideos(adAccountId);
  const i = await describeAccountImages(adAccountId);
  return {
    ...v,
    ...i,
    producedNew: v.videosTranscribed > 0 || i.imagesDescribed > 0,
  };
}

/**
 * The media context for one creative, formatted for the classifier prompt.
 * Returns "" when the creative has no analysed media — the classifier then
 * sees exactly what it saw before this feature existed.
 */
export function formatMediaContext(media: {
  transcript?: string | null;
  imageDescription?: string | null;
}): string {
  const parts: string[] = [];
  if (media.transcript) parts.push(`Video transcript: ${media.transcript}`);
  if (media.imageDescription) parts.push(`Image: ${media.imageDescription}`);
  return parts.join("\n");
}
