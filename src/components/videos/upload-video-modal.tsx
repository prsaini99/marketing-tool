"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, UploadCloud, X } from "lucide-react";
import { pollVideoUntilReady, uploadVideoChunked } from "@/lib/upload-video";

/**
 * Upload an ad video via Meta's resumable, 3-phase flow (see
 * src/lib/upload-video.ts for the chunked driver). Progress is driven by
 * bytes transferred so the user sees a real bar; Meta encodes async after.
 */

export interface VideoAccountOption {
  metaAdAccountId: string; // act_-prefixed
  name: string;
  businessName: string;
}

interface UploadVideoModalProps {
  open: boolean;
  accounts: VideoAccountOption[];
  onClose: () => void;
}

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export function UploadVideoModal({
  open,
  accounts,
  onClose,
}: UploadVideoModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [accountId, setAccountId] = useState(accounts[0]?.metaAdAccountId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Upload state machine: idle → uploading (with %) → done/error.
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0); // 0..100
  const [phase, setPhase] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setAccountId(accounts[0]?.metaAdAccountId ?? "");
    setFile(null);
    setTitle("");
    setDescription("");
    setError(null);
    setUploading(false);
    setProgress(0);
    setPhase("");
  }, [open, accounts]);

  useEffect(() => {
    if (!open) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !uploading) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, uploading, onClose]);

  const validationError = (() => {
    if (!accountId) return "Pick an ad account.";
    if (!file) return "Choose a video file.";
    if (file && !file.type.startsWith("video/"))
      return "That file isn't a video.";
    return null;
  })();

  async function upload() {
    if (validationError || !file) return;
    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      const { videoId } = await uploadVideoChunked(file, accountId, {
        title,
        description,
        onPhase: setPhase,
        onProgress: setProgress,
      });

      // Bytes are on Meta; now it encodes. Poll until ready so the library
      // shows it as Ready with a thumbnail automatically — no manual Sync.
      // The status endpoint refreshes the local row read-through, so a plain
      // router.refresh() afterwards reflects the latest state either way.
      setProgress(100);
      setPhase("Processing on Meta…");
      const status = await pollVideoUntilReady(videoId, accountId, {
        onTick: (s) => {
          if (s.status) {
            setPhase(`Processing on Meta… (${s.status.toLowerCase()})`);
          }
        },
      });
      const ready =
        (!status.status || status.status.toLowerCase() === "ready") &&
        Boolean(status.thumbnailUrl);
      setPhase(ready ? "Ready" : "Still processing — will appear after Sync");
      router.refresh();
      setTimeout(() => onClose(), ready ? 700 : 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-video-title"
        className="flex w-full max-w-lg flex-col rounded-lg border border-border bg-background shadow-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h2
              id="upload-video-title"
              className="text-sm font-semibold tracking-tight"
            >
              Upload video
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Uploaded in chunks through our server — your token stays
              server-side. Meta encodes it after upload.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">
              Ad account <span className="text-danger">*</span>
            </label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={uploading || accounts.length === 0}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {accounts.length === 0 && (
                <option value="">No accounts available</option>
              )}
              {accounts.map((a) => (
                <option key={a.metaAdAccountId} value={a.metaAdAccountId}>
                  {a.businessName} · {a.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">
              Video file <span className="text-danger">*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={uploading}
              className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-surface-2"
            />
            {file && (
              <p className="text-[11px] text-subtle">
                {file.name} · {formatBytes(file.size)}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">
              Title (optional)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={uploading}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {(uploading || progress > 0) && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-subtle">
                <span>{phase}</span>
                <span className="tabular-nums">{progress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-[11px] text-subtle">
            {validationError ?? "Ready to upload."}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={upload}
              disabled={uploading || Boolean(validationError)}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UploadCloud className="h-3.5 w-3.5" />
              )}
              {uploading ? "Uploading…" : "Upload video"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
