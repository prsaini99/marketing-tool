/**
 * Audio transcription — the same single-vendor funnel as chat.ts and
 * embeddings.ts. Anything that needs speech-to-text goes through here, never
 * through its own OpenAI client.
 *
 * whisper-1 rather than the newer gpt-4o-transcribe variants, for one
 * concrete reason: it accepts raw MP4 CONTAINERS. Meta serves ad videos as
 * mp4; being able to hand the downloaded file straight to the API means no
 * ffmpeg dependency, no audio-extraction step, no temp files. The moment an
 * extraction pipeline exists this choice can be revisited.
 *
 * The 25MB request cap is the API's, not ours. Callers are expected to skip
 * oversized files rather than fail a batch — a too-long video simply keeps
 * transcript = null and remains classifiable from its copy alone.
 */

import OpenAI, { toFile } from "openai";

const openai = new OpenAI();

export const TRANSCRIPTION_MODEL = "whisper-1";

/** The API rejects uploads over 25MB; leave headroom for multipart overhead. */
export const MAX_TRANSCRIBE_BYTES = 24 * 1024 * 1024;

/**
 * Transcribe an mp4/mp3/wav buffer. Returns the plain-text transcript —
 * possibly "" for a video with no speech (music-only ads are common).
 */
export async function transcribeBuffer(
  data: Buffer,
  filename = "video.mp4",
): Promise<string> {
  if (data.byteLength > MAX_TRANSCRIBE_BYTES) {
    throw new Error(
      `File is ${(data.byteLength / 1_048_576).toFixed(1)}MB, over the ${MAX_TRANSCRIBE_BYTES / 1_048_576}MB transcription cap`,
    );
  }
  const res = await openai.audio.transcriptions.create({
    file: await toFile(data, filename),
    model: TRANSCRIPTION_MODEL,
  });
  return res.text.trim();
}
