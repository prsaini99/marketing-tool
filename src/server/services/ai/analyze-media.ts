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
import { readAsset } from "@/lib/storage/assets";
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

/**
 * Bytes for an asset, preferring our own storage over Meta's URL.
 *
 * This is why analysis coverage used to be so thin. It fetched the
 * *.fbcdn.net URL directly, and those hostnames are removed from global DNS
 * within about a day of being issued, so the fetch failed with a DNS error
 * and the asset was silently skipped. Nothing logged a problem: a skipped
 * image looks identical to an image that has not been reached yet.
 *
 * Now the capture step has already put the bytes in our bucket at sync time,
 * when the URL was still live. Reading from there makes analysis independent
 * of Meta's CDN entirely. The URL stays as a fallback for assets captured
 * before storage existed, or when storage is not configured.
 */
async function assetBytes(
  row: { storagePath: string | null },
  fallbackUrl: string | null,
  maxBytes: number,
): Promise<Buffer | null> {
  if (row.storagePath) {
    const stored = await readAsset(row.storagePath);
    if (stored && stored.body.byteLength <= maxBytes) {
      return Buffer.from(stored.body);
    }
  }
  return fallbackUrl ? download(fallbackUrl, maxBytes) : null;
}

/**
 * Retry an OpenAI call through a rate limit.
 *
 * Vision descriptions send the whole image as a base64 data URL, so a
 * library of forty burns through a tokens-per-minute quota quickly. Without
 * this, a 429 was caught, logged and counted as "skipped", which is
 * indistinguishable in the result from an image that genuinely could not be
 * described. Twenty of forty-four images were lost that way on the first
 * real run.
 *
 * Only 429 is retried. A 400 on a malformed image should fail immediately
 * rather than be attempted five times.
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const status = (e as { status?: number })?.status;
      const rateLimited = status === 429 || /rate limit/i.test(msg);
      if (!rateLimited || i === attempts - 1) throw e;
      // Back off well past the per-minute window rather than the few
      // hundred milliseconds the error suggests: the quota is refilling for
      // every caller at once, and returning too eagerly just burns another
      // attempt.
      const waitMs = 5000 * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
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
export interface DescribeImagesOptions {
  /**
   * Describe every image in the account library, not only those a creative
   * currently references.
   *
   * Default false, which is right for creative classification: that feature
   * analyses ads that exist, so an unused upload is noise. It is wrong for
   * the campaign copilot, which chooses assets from the WHOLE library and
   * sees nothing but a filename for anything undescribed. On the reference
   * account only 9 of 40 creatives carry an imageHash, so the default scope
   * leaves 35 of 44 library images permanently invisible to the planner.
   */
  includeUnreferenced?: boolean;
}

export async function describeAccountImages(
  adAccountId: string,
  opts: DescribeImagesOptions = {},
): Promise<Pick<MediaAnalysisResult, "imagesConsidered" | "imagesDescribed" | "imagesSkipped">> {
  const referencedHashes = (
    await prisma.adCreative.findMany({
      where: { adAccountId, imageHash: { not: null } },
      select: { imageHash: true },
    })
  ).map((c) => c.imageHash!) as string[];

  if (!opts.includeUnreferenced && referencedHashes.length === 0) {
    return { imagesConsidered: 0, imagesDescribed: 0, imagesSkipped: 0 };
  }

  const images = await prisma.adImage.findMany({
    where: {
      adAccountId,
      ...(opts.includeUnreferenced
        ? {}
        : { metaImageHash: { in: referencedHashes } }),
      // Either we hold the bytes or Meta still has a live URL. A row with
      // neither cannot be analysed at all.
      OR: [{ storagePath: { not: null } }, { url: { not: null } }],
      aiDescription: null,
    },
    select: { id: true, metaImageHash: true, url: true, storagePath: true },
  });

  let described = 0;
  let skipped = 0;
  for (const img of images) {
    // Download → base64 data URL rather than passing the CDN link through:
    // the signed URL may expire between our check and OpenAI's fetch, and a
    // data URL removes that race entirely.
    const buf = await assetBytes(img, img.url, 8 * 1024 * 1024);
    if (!buf) {
      skipped++;
      continue;
    }
    try {
      const out = await withRateLimitRetry(() =>
        completeJson<{ description?: string; overlaidText?: string }>(
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
      ));
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
