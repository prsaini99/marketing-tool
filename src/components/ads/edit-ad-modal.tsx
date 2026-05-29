"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Image as ImageIcon, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Edit Ad modal. Pre-fills from current values and sends only the diff to
 * PATCH /api/ads/[id]. Right pane shows the live "what will change" payload,
 * mirroring the Edit Campaign / Edit Ad Set modals.
 *
 * Editable: name, status (Active/Paused), and a creative swap. The creative
 * picker lazy-loads the account's synced creatives from GET /api/creatives
 * when the modal opens, so the ads tables don't have to pre-ship every
 * account's creative list.
 *
 * ARCHIVED stays in the bulk actions, not here.
 */

export interface EditableAd {
  metaAdId: string;
  name: string;
  status: string;
  metaCreativeId: string | null;
  creativeThumbnailUrl: string | null;
  // Account the ad belongs to — used to fetch its creative options.
  metaAdAccountId: string;
}

interface CreativeOption {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  status: string | null;
}

interface EditAdModalProps {
  open: boolean;
  ad: EditableAd;
  onClose: () => void;
}

export function EditAdModal({ open, ad, onClose }: EditAdModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(ad.name);
  const [status, setStatus] = useState<"ACTIVE" | "PAUSED">(
    ad.status === "ACTIVE" ? "ACTIVE" : "PAUSED",
  );
  const [creativeId, setCreativeId] = useState<string>(ad.metaCreativeId ?? "");

  // Lazy-loaded creative options for the swap picker.
  const [creatives, setCreatives] = useState<CreativeOption[] | null>(null);
  const [creativesLoading, setCreativesLoading] = useState(false);
  const [creativesError, setCreativesError] = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  // Re-seed when the modal (re)opens.
  useEffect(() => {
    if (!open) return;
    setName(ad.name);
    setStatus(ad.status === "ACTIVE" ? "ACTIVE" : "PAUSED");
    setCreativeId(ad.metaCreativeId ?? "");
    setError(null);
  }, [open, ad.name, ad.status, ad.metaCreativeId]);

  // Fetch the account's creatives once per open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCreativesLoading(true);
    setCreativesError(null);
    fetch(
      `/api/creatives?accountId=${encodeURIComponent(ad.metaAdAccountId)}`,
    )
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          creatives?: CreativeOption[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setCreativesError(data.error ?? `HTTP ${res.status}`);
          setCreatives([]);
          return;
        }
        setCreatives(data.creatives ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCreativesError(err instanceof Error ? err.message : "Failed");
        setCreatives([]);
      })
      .finally(() => {
        if (!cancelled) setCreativesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ad.metaAdAccountId]);

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
      if (e.key === "Escape" && !submitting) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => firstFieldRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // ── Diff ──────────────────────────────────────────────────────────────
  const trimmedName = name.trim();
  const changes: Record<string, unknown> = {};
  if (trimmedName && trimmedName !== ad.name) {
    changes.name = trimmedName;
  }
  if (status !== ad.status) {
    changes.status = status;
  }
  if (creativeId && creativeId !== (ad.metaCreativeId ?? "")) {
    changes.creative = { creative_id: creativeId };
  }
  const hasChanges = Object.keys(changes).length > 0;

  const validationError = (() => {
    if (!trimmedName) return "Ad name can't be empty.";
    if (!hasChanges) return "No changes yet.";
    return null;
  })();

  // The currently-selected creative option (for the swap preview thumbnail).
  const selectedCreative =
    creatives?.find((c) => c.id === creativeId) ?? null;

  async function submit() {
    if (validationError) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (changes.name) body.name = changes.name;
      if (changes.status) body.status = changes.status;
      if (changes.creative) body.metaCreativeId = creativeId;
      const res = await fetch(
        `/api/ads/${encodeURIComponent(ad.metaAdId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update ad");
    } finally {
      setSubmitting(false);
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
        aria-labelledby="edit-ad-title"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-background shadow-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h2
              id="edit-ad-title"
              className="text-sm font-semibold tracking-tight"
            >
              Edit ad
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted">
              {ad.name} · <span className="font-mono">{ad.metaAdId}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_300px]">
            {/* Form */}
            <div className="space-y-4 border-b border-border px-5 py-4 lg:border-b-0 lg:border-r">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Ad name
                </label>
                <input
                  ref={firstFieldRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Status
                </label>
                <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
                  {(["ACTIVE", "PAUSED"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatus(s)}
                      disabled={submitting}
                      className={cn(
                        "rounded-sm px-2.5 py-1 font-medium transition-colors",
                        status === s
                          ? s === "ACTIVE"
                            ? "bg-green-50 text-green-700"
                            : "bg-surface-2 text-foreground"
                          : "text-muted hover:text-foreground",
                      )}
                    >
                      {s === "ACTIVE" ? "Active" : "Paused"}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-subtle">
                  An ad only delivers when its ad set and campaign are active.
                </p>
              </div>

              {/* Creative swap */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Creative
                </label>
                {creativesLoading ? (
                  <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading creatives…
                  </p>
                ) : creativesError ? (
                  <p className="text-xs text-danger">{creativesError}</p>
                ) : creatives && creatives.length > 0 ? (
                  <>
                    <select
                      value={creativeId}
                      onChange={(e) => setCreativeId(e.target.value)}
                      disabled={submitting}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      {/* Keep the current creative selectable even if it's not
                          in the synced list (e.g. created outside our tool). */}
                      {ad.metaCreativeId &&
                        !creatives.some((c) => c.id === ad.metaCreativeId) && (
                          <option value={ad.metaCreativeId}>
                            Current creative ({ad.metaCreativeId})
                          </option>
                        )}
                      {creatives.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.status ? ` · ${c.status}` : ""}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2 pt-0.5">
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded ring-1 ring-border">
                        {(selectedCreative?.thumbnailUrl ??
                          ad.creativeThumbnailUrl) ? (
                          <Image
                            src={
                              (selectedCreative?.thumbnailUrl ??
                                ad.creativeThumbnailUrl) as string
                            }
                            alt="Creative preview"
                            fill
                            sizes="48px"
                            className="object-cover"
                            unoptimized
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-surface-2 text-subtle">
                            <ImageIcon className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                      <p className="text-[11px] text-subtle">
                        Swapping the creative changes what viewers see. Only
                        creatives already in this account are selectable.
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="rounded-md border border-dashed border-border bg-surface px-3 py-2 text-[11px] text-muted">
                    No creatives synced for this account yet. Sync creatives
                    from the Creatives page to enable swapping.
                  </p>
                )}
              </div>
            </div>

            {/* Diff preview */}
            <div className="bg-surface px-5 py-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">
                What will change
              </div>
              <p className="mt-0.5 text-[11px] text-subtle">
                Only the diff is sent to{" "}
                <span className="font-mono">PATCH /{ad.metaAdId}</span>.
              </p>
              {hasChanges ? (
                <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-background p-3 text-[11px] leading-relaxed text-foreground">
                  {JSON.stringify(changes, null, 2)}
                </pre>
              ) : (
                <p className="mt-3 rounded-md border border-dashed border-border bg-background px-3 py-2 text-[11px] text-muted">
                  No changes yet — edit a field to see the payload.
                </p>
              )}
              <div className="mt-3 text-[11px] text-subtle">
                Audit log: ad.update row written with before/after.
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3">
          {error && (
            <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-subtle">
              {validationError ?? "Ready to save."}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || Boolean(validationError)}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {submitting ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
