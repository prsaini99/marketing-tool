/**
 * Higgsfield API client — the ONLY place in the codebase that talks to
 * Higgsfield, mirroring the rule that only src/lib/meta/ talks to Meta.
 *
 * Kling v2.1 Master, text-to-video. Chosen because it takes a separate
 * negative_prompt (which the brand kit's do-not list fills) and supports
 * both placements the studio can use.
 *
 * Their status vocabulary is mapped into ours here, so a vendor rename
 * does not reach the database or the UI.
 *
 * VERIFY ON FIRST CREDIT — none of the following was checked against a real
 * generation, because the account had no credits when this was written:
 *   - the request field names sent by createVideo
 *   - the field holding the request id in the create response
 *   - the status vocabulary mapStatus translates
 *   - where the finished video URL lives
 *   - which field carries the failure reason
 *   - whether the payload carries a thumbnail alongside the video, and
 *     under which key
 *   - which envelope fields the status payload repeats (e.g. `status_url`,
 *     `cancel_url`), so the control-key exclusions below can be confirmed
 *     or trimmed
 * What WAS verified: the base URL, the create path, and that the auth header
 * form is `Key <id>:<secret>` (a nonexistent request id returns 404, not 401).
 * Run one generation, read the payload the client logs, and correct the two
 * functions below if they disagree.
 */

import type { KlingRequest, VideoJob, VideoJobStatus } from "./types";

const BASE = "https://api.higgsfield.ai";
const CREATE_PATH = "/kling-video/v2.1/master/text-to-video";

/** Without both, the feature is off rather than broken. */
export function higgsfieldConfigured(): boolean {
  return Boolean(
    process.env.HIGGSFIELD_KEY_ID?.trim() &&
      process.env.HIGGSFIELD_KEY_SECRET?.trim(),
  );
}

function authHeader(): string {
  return `Key ${process.env.HIGGSFIELD_KEY_ID}:${process.env.HIGGSFIELD_KEY_SECRET}`;
}

/**
 * Their vocabulary → ours. UNVERIFIED (see file header) — the lists below are
 * a broad guess at plausible synonyms, not an observed vocabulary.
 *
 * Unrecognised strings deliberately map to RUNNING rather than FAILED: an
 * unanticipated intermediate status should keep a job polling until the age
 * ceiling gives up on it, whereas defaulting to FAILED would abandon a job
 * that is merely in a state we didn't anticipate.
 */
function mapStatus(raw: unknown): VideoJobStatus {
  const s = String(raw ?? "").toLowerCase();
  if (s === "queued" || s === "pending") return "QUEUED";
  if (
    s === "in_progress" ||
    s === "processing" ||
    s === "started" ||
    s === "running"
  )
    return "RUNNING";
  if (s === "completed" || s === "succeeded" || s === "success") return "READY";
  if (s === "failed" || s === "error") return "FAILED";
  if (s === "cancelled" || s === "canceled") return "CANCELLED";
  return "RUNNING";
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    // Their message, not a generic one — the same reasoning as readMetaError:
    // a vendor's own error text is the only thing that says what to fix.
    throw new Error(
      `Higgsfield ${res.status}: ${text.slice(0, 300) || res.statusText}`,
    );
  }
  return text ? JSON.parse(text) : {};
}

export async function createVideo(req: KlingRequest): Promise<VideoJob> {
  const body = await call(CREATE_PATH, {
    method: "POST",
    body: JSON.stringify({
      prompt: req.prompt,
      negative_prompt: req.negativePrompt ?? "",
      duration: req.durationSeconds,
      aspect_ratio: req.aspectRatio,
      cfg_scale: req.cfgScale ?? 0.5,
    }),
  });
  const job = normalise(body);
  if (!job.requestId) {
    // The one place tolerance is wrong. Everything else in this file guesses
    // generously because a wrong guess costs a missing field; guessing here
    // costs a paid clip. Without a request id the job can never be polled,
    // so a row written from this response would sit QUEUED forever while the
    // vendor charges for a render nobody will ever collect. Fail loudly, and
    // log the raw payload so the first real generation says which key the id
    // actually arrived under.
    console.error(
      "[higgsfield] create response carried no request id:",
      JSON.stringify(body),
    );
    throw new Error(
      "Higgsfield accepted the request but returned no request id, so the job cannot be tracked. The raw response is in the server log — findRequestId in src/lib/higgsfield/client.ts needs the key it actually used.",
    );
  }
  return job;
}

export async function getVideoJob(requestId: string): Promise<VideoJob> {
  const body = await call(`/requests/${encodeURIComponent(requestId)}/status`);
  return normalise(body);
}

// Logged once per process the first time a job reaches a terminal state.
// The whole response shape is what Task 1 could not verify, so the first
// real generation should print it rather than requiring a probe to be
// re-run by hand.
let loggedTerminalShape = false;

function normalise(body: unknown): VideoJob {
  const b = (body ?? {}) as Record<string, unknown>;
  const status = mapStatus(b.status);

  if (
    !loggedTerminalShape &&
    (status === "READY" || status === "FAILED" || status === "CANCELLED")
  ) {
    loggedTerminalShape = true;
    // Contains no credentials — the response body only.
    console.info("[higgsfield] first terminal payload:", JSON.stringify(body));
  }

  return {
    requestId: findRequestId(b),
    status,
    videoUrl: findVideoUrl(b),
    // Only a terminal payload can carry a failure reason. findError reads
    // `message`/`detail`, which on a RUNNING payload are as likely to say
    // "position 4 in queue" as anything wrong — and the caller stores what
    // it gets, so an informational line would be persisted as the job's
    // error and corrupt exactly the signal VERIFY ON FIRST CREDIT exists
    // to capture.
    error: status === "FAILED" || status === "CANCELLED" ? findError(b) : null,
  };
}

function findRequestId(b: Record<string, unknown>): string {
  const candidate = b.request_id ?? b.id ?? b.requestId;
  return typeof candidate === "string" ? candidate : "";
}

/**
 * UNVERIFIED, like findVideoUrl. Their failure payload's key is unknown, and
 * a failed job with no reason shown is worse than one with an odd label — so
 * this takes the first of several plausible keys rather than betting on one.
 */
function findError(b: Record<string, unknown>): string | null {
  const direct = b.error ?? b.message ?? b.detail ?? b.error_message;
  if (typeof direct === "string" && direct.trim()) return direct;
  const results = b.results as Record<string, unknown> | undefined;
  const nested = results?.error ?? results?.message ?? results?.detail;
  return typeof nested === "string" && nested.trim() ? nested : null;
}

/**
 * UNVERIFIED — see VERIFY ON FIRST CREDIT above.
 *
 * Walks the payload rather than reading one documented path, because the
 * exact location of the file is the thing we could not check. A depth-first
 * search for the first video-looking URL is right under every shape the
 * documentation suggests, and under several it does not.
 *
 * Preferred: a URL that is unambiguously a video file. Fallback: any
 * http(s) URL sitting under a key named for the output — presigned download
 * links often carry no extension at all, and returning null there would
 * lose a generation that succeeded and was charged for.
 */
function findVideoUrl(value: unknown): string | null {
  return findExtensionedVideoUrl(value) ?? findLikelyOutputUrl(value);
}

function findExtensionedVideoUrl(value: unknown, depth = 0): string | null {
  if (depth > 6) return null;
  if (typeof value === "string") {
    return /^https?:\/\/\S+\.(mp4|mov|webm|m4v)(\?|$)/i.test(value)
      ? value
      : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findExtensionedVideoUrl(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = findExtensionedVideoUrl(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Fallback pass, used only when no extensioned URL was found. Accepts any
 * http(s) string whose *key* looks output-shaped, since a presigned link's
 * value alone often gives no hint of being a video.
 */
const OUTPUT_KEY = /video|url|output|result|file|download/i;

/**
 * Extensions that are definitely not the video. The fallback pass matches on
 * key name rather than file type, so a thumbnail under `image_url` or
 * `preview_url` would otherwise be returned as the clip — and stored as
 * video/mp4, leaving a READY job whose file will not play.
 */
const NOT_VIDEO = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;

/**
 * Keys that are part of the job envelope rather than its output. Higgsfield's
 * documented response carries `status_url` and `cancel_url`, both of which
 * match OUTPUT_KEY on "url" — so without this the fallback would return the
 * polling endpoint as the video and store a JSON document as video/mp4.
 * Checked before OUTPUT_KEY: `status_url` matches both, and this must win.
 */
const CONTROL_KEY = /status|cancel|callback|webhook|self|next|prev/i;

function findLikelyOutputUrl(
  value: unknown,
  depth = 0,
  key?: string,
): string | null {
  if (depth > 6) return null;
  if (typeof value === "string") {
    return key &&
      !CONTROL_KEY.test(key) &&
      OUTPUT_KEY.test(key) &&
      /^https?:\/\/\S+$/i.test(value) &&
      !NOT_VIDEO.test(value)
      ? value
      : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findLikelyOutputUrl(v, depth + 1, key);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const hit = findLikelyOutputUrl(v, depth + 1, k);
      if (hit) return hit;
    }
  }
  return null;
}
