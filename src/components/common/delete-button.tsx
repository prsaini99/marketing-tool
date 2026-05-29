"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Reusable Delete control — a trash-icon button that opens a confirmation
 * modal, then issues DELETE to the matching API route. Destructive +
 * irreversible, so the modal is deliberately heavier than the Duplicate one:
 *
 *   • Always states the delete is permanent / can't be undone.
 *   • Cascading entities (campaign → ad sets + ads, ad set → ads) require
 *     TYPING the entity name to enable the button — no accidental one-click.
 *   • Library assets (creative/image/video) note Meta may reject if in use.
 *
 * Honors the senior's hard rule: no destructive Meta write without a
 * designed confirm flow. The server also audit-logs every delete.
 */

type EntityType =
  | "campaign"
  | "adset"
  | "ad"
  | "audience"
  | "conversion"
  | "creative"
  | "image"
  | "video";

interface EntityConfig {
  label: string;
  apiPath: (id: string) => string;
  cascades: boolean; // require type-to-confirm + cascade warning
  childLabel?: string; // e.g. "ad sets and ads"
  inUseNote?: string; // shown for library assets Meta may refuse to delete
}

// Only entities whose DELETE route exists are listed. Extend as routes land.
const ENTITY_CONFIG: Record<EntityType, EntityConfig> = {
  campaign: {
    label: "campaign",
    apiPath: (id) => `/api/campaigns/${encodeURIComponent(id)}`,
    cascades: true,
    childLabel: "ad sets and ads",
  },
  adset: {
    label: "ad set",
    apiPath: (id) => `/api/adsets/${encodeURIComponent(id)}`,
    cascades: true,
    childLabel: "ads",
  },
  ad: {
    label: "ad",
    apiPath: (id) => `/api/ads/${encodeURIComponent(id)}`,
    cascades: false,
  },
  // The following routes are added in later delete slices; configs are here
  // so wiring a table is a one-liner once the route exists.
  audience: {
    label: "audience",
    apiPath: (id) => `/api/audiences/${encodeURIComponent(id)}`,
    cascades: false,
  },
  conversion: {
    label: "conversion",
    apiPath: (id) => `/api/conversions/${encodeURIComponent(id)}`,
    cascades: false,
  },
  creative: {
    label: "creative",
    apiPath: (id) => `/api/creatives/${encodeURIComponent(id)}`,
    cascades: false,
    inUseNote: "Meta refuses to delete a creative still used by an ad.",
  },
  image: {
    label: "image",
    apiPath: (id) => `/api/images/${encodeURIComponent(id)}`,
    cascades: false,
    inUseNote: "Meta refuses to delete an image still used by a creative.",
  },
  video: {
    label: "video",
    apiPath: (id) => `/api/videos/${encodeURIComponent(id)}`,
    cascades: false,
    inUseNote: "Meta refuses to delete a video still used by a creative.",
  },
};

interface DeleteButtonProps {
  entityType: EntityType;
  metaId: string;
  name: string;
}

export function DeleteButton({ entityType, metaId, name }: DeleteButtonProps) {
  const router = useRouter();
  const cfg = ENTITY_CONFIG[entityType];
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setConfirmText("");
    setError(null);
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [open]);

  // Cascading deletes require the typed name to match exactly.
  const typeToConfirmOk = !cfg.cascades || confirmText.trim() === name.trim();

  async function submit() {
    if (!typeToConfirmOk) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(cfg.apiPath(metaId), { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Delete ${name}`}
        title={`Delete ${cfg.label}`}
        className="rounded-md p-1.5 text-subtle transition-colors hover:bg-red-50 hover:text-danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={(e) => {
              e.stopPropagation();
              if (!submitting) setOpen(false);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-lg border border-border bg-background shadow-lg"
            >
              <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-50 text-danger">
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <h2 className="text-sm font-semibold tracking-tight">
                    Delete {cfg.label}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  aria-label="Close"
                  className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 px-5 py-4">
                <p className="text-sm text-muted">
                  Permanently delete{" "}
                  <span className="font-medium text-foreground">{name}</span>?
                  This <span className="font-medium text-danger">cannot be undone</span>
                  {" "}— Meta purges deleted objects. (To pause temporarily,
                  use Archive instead.)
                </p>

                {cfg.cascades && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
                    This also permanently deletes every {cfg.childLabel} inside
                    it.
                  </div>
                )}

                {cfg.inUseNote && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    {cfg.inUseNote}
                  </div>
                )}

                {cfg.cascades && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Type{" "}
                      <span className="font-mono text-danger">{name}</span> to
                      confirm
                    </label>
                    <input
                      type="text"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      disabled={submitting}
                      autoComplete="off"
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-danger focus:outline-none focus:ring-1 focus:ring-danger"
                    />
                  </div>
                )}

                {error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
                    {error}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting || !typeToConfirmOk}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    "bg-red-600 hover:bg-red-700",
                  )}
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {submitting ? "Deleting…" : `Delete ${cfg.label}`}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
