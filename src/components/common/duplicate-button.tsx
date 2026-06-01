"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Copy, Loader2, X } from "lucide-react";

/**
 * Reusable Duplicate control: a copy-icon button that opens a small confirm
 * modal, then POSTs to /api/duplicate. Works for campaign / ad set / ad —
 * the only level-specific bit is the deep-copy toggle (hidden for ads, which
 * have no children).
 *
 * The copy is always created PAUSED (enforced server-side); the modal states
 * that plainly so the operator knows the clone won't start spending.
 *
 * Self-contained (own modal + state) so each table row just drops one
 * <DuplicateButton/> into its actions cell — no shared parent state.
 */

type Level = "campaign" | "adset" | "ad";

const LEVEL_LABEL: Record<Level, string> = {
  campaign: "campaign",
  adset: "ad set",
  ad: "ad",
};

interface DuplicateButtonProps {
  level: Level;
  metaId: string;
  name: string;
}

export function DuplicateButton({ level, metaId, name }: DuplicateButtonProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [deepCopy, setDeepCopy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setDeepCopy(true);
    setError(null);
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [open]);

  const canDeepCopy = level !== "ad";
  const childLabel = level === "campaign" ? "ad sets and ads" : "ads";

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level,
          metaId,
          deepCopy: canDeepCopy ? deepCopy : false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate");
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
        aria-label={`Duplicate ${name}`}
        title={`Duplicate ${LEVEL_LABEL[level]}`}
        className="rounded-md p-1.5 text-subtle transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <Copy className="h-3.5 w-3.5" />
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
                <h2 className="text-sm font-semibold tracking-tight">
                  Duplicate {LEVEL_LABEL[level]}
                </h2>
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
                  A copy of{" "}
                  <span className="font-medium text-foreground">{name}</span>{" "}
                  will be created on Meta, named{" "}
                  <span className="font-mono text-foreground">
                    &ldquo;{name} - Copy&rdquo;
                  </span>
                  .
                </p>

                {canDeepCopy && (
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-surface px-3 py-2">
                    <input
                      type="checkbox"
                      checked={deepCopy}
                      onChange={(e) => setDeepCopy(e.target.checked)}
                      disabled={submitting}
                      className="mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-border accent-blue-600"
                    />
                    <span className="text-xs">
                      <span className="font-medium text-foreground">
                        Also duplicate its {childLabel}
                      </span>
                      <span className="mt-0.5 block text-subtle">
                        Deep copy — recreates the full structure underneath.
                        Off = just the {LEVEL_LABEL[level]} shell.
                      </span>
                    </span>
                  </label>
                )}

                <div className="rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-muted">
                  The copy is created{" "}
                  <span className="font-medium text-foreground">PAUSED</span> so
                  it never starts spending before you review it.
                </div>

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
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {submitting ? "Duplicating…" : "Duplicate"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
