"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, X } from "lucide-react";

/**
 * Upload a standalone image into an account's library (POST /api/images).
 * Unlike video, there's no chunking or encoding wait — Meta returns the hash
 * immediately, so this is a single multipart request. Counterpart to the
 * Upload-video modal.
 */

export interface ImageAccountOption {
  metaAdAccountId: string; // act_-prefixed
  name: string;
  businessName: string;
}

interface UploadImageModalProps {
  open: boolean;
  accounts: ImageAccountOption[];
  onClose: () => void;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export function UploadImageModal({
  open,
  accounts,
  onClose,
}: UploadImageModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [accountId, setAccountId] = useState(
    accounts[0]?.metaAdAccountId ?? "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) return;
    setAccountId(accounts[0]?.metaAdAccountId ?? "");
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setUploading(false);
    setError(null);
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

  function handleFile(f: File | null) {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (!f) {
      setFile(null);
      return;
    }
    if (!f.type.startsWith("image/")) {
      setError("Please pick an image file.");
      return;
    }
    if (f.size > MAX_IMAGE_BYTES) {
      setError(
        `Image is ${formatBytes(f.size)} — limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
      );
      return;
    }
    setError(null);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  }

  const validationError = (() => {
    if (!accountId) return "Pick an ad account.";
    if (!file) return "Choose an image file.";
    return null;
  })();

  async function upload() {
    if (validationError || !file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("accountId", accountId);
      form.set("image", file, file.name);
      const res = await fetch("/api/images", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      router.refresh();
      onClose();
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
        aria-labelledby="upload-image-title"
        className="flex w-full max-w-lg flex-col rounded-lg border border-border bg-background shadow-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h2
              id="upload-image-title"
              className="text-sm font-semibold tracking-tight"
            >
              Upload image
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Uploaded to the account&apos;s ad-image library — your token stays
              server-side. Reusable across ads &amp; creatives.
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

          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground">
              Image file <span className="text-danger">*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              disabled={uploading}
              className="hidden"
            />
            {previewUrl ? (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Selected image"
                  className="max-h-64 w-full rounded-md border border-border object-contain"
                />
                <div className="flex items-center justify-between text-[11px] text-subtle">
                  <span className="truncate">
                    {file?.name} · {file ? formatBytes(file.size) : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      handleFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    disabled={uploading}
                    className="ml-2 shrink-0 rounded border border-border bg-background px-2 py-0.5 hover:bg-surface-2"
                  >
                    Replace
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-surface px-4 py-6 text-xs text-muted hover:bg-surface-2 transition-colors"
              >
                <ImagePlus className="h-5 w-5 text-subtle" />
                <span>Click to choose an image</span>
                <span className="text-[10px] text-subtle">
                  JPG / PNG · up to {MAX_IMAGE_BYTES / 1024 / 1024} MB
                </span>
              </button>
            )}
          </div>

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
                <ImagePlus className="h-3.5 w-3.5" />
              )}
              {uploading ? "Uploading…" : "Upload image"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
