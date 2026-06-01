/**
 * Client-side driver for Meta's resumable, 3-phase ad-video upload, proxied
 * through our API so the Meta token never reaches the browser:
 *
 *   1. POST /start    → upload session + video id
 *   2. loop: slice into <4 MB chunks, POST /transfer each (each request clears
 *      Vercel's 4.5 MB body cap), advance by the offset Meta returns
 *   3. POST /finish   → Meta encodes async; a PROCESSING row is mirrored
 *
 * Shared by the standalone Upload-video modal and the Create-ad video tab.
 * After this resolves the video is uploaded but still ENCODING — it has no
 * poster yet, so it can't back an ad creative until it reaches `ready`. Poll
 * GET /api/videos/[id]?accountId=… to wait for that.
 */

// 3 MB — comfortably under Vercel's 4.5 MB request-body cap once multipart
// overhead is added.
export const VIDEO_CHUNK_SIZE = 3 * 1024 * 1024;

export interface UploadVideoOptions {
  title?: string;
  description?: string;
  onPhase?: (phase: string) => void;
  onProgress?: (percent: number) => void; // 0..100
}

export async function uploadVideoChunked(
  file: File,
  metaAdAccountId: string,
  opts: UploadVideoOptions = {},
): Promise<{ videoId: string }> {
  const { title, description, onPhase, onProgress } = opts;

  // Phase 1 — start.
  onPhase?.("Starting…");
  const startRes = await fetch("/api/videos/upload/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metaAdAccountId, fileSize: file.size }),
  });
  const startData = await startRes.json().catch(() => ({}));
  if (!startRes.ok) throw new Error(startData?.error ?? "Start failed");
  const { uploadSessionId, videoId } = startData as {
    uploadSessionId: string;
    videoId: string;
  };

  // Phase 2 — transfer chunks, advancing by Meta's returned offset.
  let offset = 0;
  while (offset < file.size) {
    onPhase?.("Uploading…");
    const slice = file.slice(offset, offset + VIDEO_CHUNK_SIZE);
    const form = new FormData();
    form.append("metaAdAccountId", metaAdAccountId);
    form.append("uploadSessionId", uploadSessionId);
    form.append("startOffset", String(offset));
    form.append("chunk", slice, "chunk");

    const transferRes = await fetch("/api/videos/upload/transfer", {
      method: "POST",
      body: form,
    });
    const transferData = await transferRes.json().catch(() => ({}));
    if (!transferRes.ok) {
      throw new Error(transferData?.error ?? "Transfer failed");
    }
    // Trust Meta's next offset; fall back to our own advance if absent.
    const next = (transferData as { startOffset?: number }).startOffset;
    offset =
      typeof next === "number" && next > offset ? next : offset + slice.size;
    onProgress?.(Math.min(100, Math.round((offset / file.size) * 100)));
  }

  // Phase 3 — finish.
  onPhase?.("Finishing…");
  const finishRes = await fetch("/api/videos/upload/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      metaAdAccountId,
      uploadSessionId,
      videoId,
      title: title?.trim() || undefined,
      description: description?.trim() || undefined,
    }),
  });
  const finishData = await finishRes.json().catch(() => ({}));
  if (!finishRes.ok) throw new Error(finishData?.error ?? "Finish failed");

  return { videoId };
}

export interface VideoStatus {
  videoId: string;
  status: string | null;
  thumbnailUrl: string | null;
  lengthSeconds: number | null;
  title: string | null;
}

/** One live status read from Meta (not our DB mirror). */
export async function fetchVideoStatus(
  videoId: string,
  metaAdAccountId: string,
): Promise<VideoStatus> {
  const res = await fetch(
    `/api/videos/${encodeURIComponent(videoId)}?accountId=${encodeURIComponent(metaAdAccountId)}`,
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as VideoStatus;
}

/**
 * Poll Meta until the video is `ready` with a poster (both are needed before
 * it can back an ad creative), or until the deadline. Resolves with the final
 * status — caller checks whether it's actually usable.
 */
export async function pollVideoUntilReady(
  videoId: string,
  metaAdAccountId: string,
  opts: {
    intervalMs?: number;
    timeoutMs?: number;
    onTick?: (status: VideoStatus) => void;
    signal?: AbortSignal;
  } = {},
): Promise<VideoStatus> {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 150_000;
  const startedAt = performance.now();

  let last: VideoStatus = {
    videoId,
    status: "processing",
    thumbnailUrl: null,
    lengthSeconds: null,
    title: null,
  };

  while (performance.now() - startedAt < timeoutMs) {
    if (opts.signal?.aborted) return last;
    try {
      last = await fetchVideoStatus(videoId, metaAdAccountId);
      opts.onTick?.(last);
      const ready =
        (!last.status || last.status.toLowerCase() === "ready") &&
        Boolean(last.thumbnailUrl);
      if (ready) return last;
    } catch {
      // Transient — keep polling until the deadline.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}
