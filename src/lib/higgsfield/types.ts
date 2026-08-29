/**
 * Normalised Higgsfield types. Nothing outside src/lib/higgsfield/ sees the
 * vendor's own response shape — same rule as src/lib/meta/types.ts, so a
 * vendor change is contained to this folder.
 */

/** Our lifecycle vocabulary, not Higgsfield's. Mapped in client.ts. */
export type VideoJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "READY"
  | "FAILED"
  | "CANCELLED";

export interface KlingRequest {
  /** Max 2500 characters — the caller truncates, this does not. */
  prompt: string;
  negativePrompt?: string;
  aspectRatio: "1:1" | "16:9" | "9:16";
  durationSeconds: 5 | 10;
  /** 0–1, Kling's prompt-adherence dial. Defaults to 0.5. */
  cfgScale?: number;
}

export interface VideoJob {
  requestId: string;
  status: VideoJobStatus;
  /** Populated only when status is READY. Expires after ~7 days. */
  videoUrl: string | null;
  error: string | null;
}
