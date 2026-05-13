"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  body: ReactNode; // string or rich JSX (lists, highlights, etc.)
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "neutral" | "danger";
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Reusable confirm dialog. Used by every bulk action that hits Meta.
 *
 * UX rules:
 *  - Click outside is no-op (only Cancel / Proceed / ESC close)
 *  - ESC closes only when not in the middle of confirming
 *  - Body scroll locked while open
 *  - `danger` variant paints the confirm button red for destructive actions
 */
export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = "Proceed",
  cancelLabel = "Cancel",
  variant = "neutral",
  loading = false,
  error = null,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, loading, onCancel]);

  if (!mounted || !open) return null;

  const confirmStyles =
    variant === "danger"
      ? "bg-danger text-white hover:bg-red-700 focus:ring-red-500/40"
      : "bg-accent text-accent-foreground hover:bg-accent-hover focus:ring-accent/40";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      // Click + keydown stay inside the modal — never bubble to whatever's
      // underneath (rows, page-level handlers, etc.).
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="w-full max-w-md rounded-lg border border-border bg-background shadow-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <h2
            id="confirm-modal-title"
            className="text-sm font-semibold tracking-tight"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 text-sm text-muted">{body}</div>

        {error && (
          <div className="px-5 pb-3">
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
              confirmStyles,
            )}
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
