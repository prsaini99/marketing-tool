"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Clock, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  callsPerDay,
  FREQUENCY_PRESETS,
  SCHEDULE_KINDS,
  type FrequencyKey,
  type ScheduleKind,
} from "@/lib/schedule";

interface SchedulesModalProps {
  accountIdUrl: string;
  accountName: string;
  onClose: () => void;
}

interface ScheduleRow {
  kind: ScheduleKind;
  frequency: FrequencyKey;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

const KIND_LABEL: Record<ScheduleKind, string> = {
  campaigns: "Campaigns",
  adsets: "Ad sets",
  ads: "Ads",
  insights: "Insights",
};

function formatRelative(iso: string | null, opts: { future?: boolean } = {}) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const ms = opts.future ? t - Date.now() : Date.now() - t;
  if (ms < 0) return opts.future ? "due now" : "just now";
  if (ms < 60_000) return opts.future ? "in <1 min" : "just now";
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    return opts.future ? `in ${m} min` : `${m} min ago`;
  }
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    return opts.future ? `in ${h} hr` : `${h} hr ago`;
  }
  const d = Math.floor(ms / 86_400_000);
  return opts.future ? `in ${d} days` : `${d} days ago`;
}

const EMPTY_DRAFT: Record<ScheduleKind, FrequencyKey> = {
  campaigns: "off",
  adsets: "off",
  ads: "off",
  insights: "off",
};

export function SchedulesModal({
  accountIdUrl,
  accountName,
  onClose,
}: SchedulesModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [draft, setDraft] =
    useState<Record<ScheduleKind, FrequencyKey>>(EMPTY_DRAFT);
  // Snapshot of the form state as it was on load — diff against this to know
  // what's dirty + what to PUT on save.
  const baseline = useRef<Record<ScheduleKind, FrequencyKey>>(EMPTY_DRAFT);

  // Wait for client mount before portal render (avoids SSR hydration mismatch).
  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll while modal is open.
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // ESC closes (per design — click-outside intentionally does nothing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fetch current schedules when the modal opens.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/accounts/${accountIdUrl}/schedules`)
      .then((r) => r.json())
      .then((data: ScheduleRow[] | { error: string }) => {
        if (cancelled) return;
        if (!Array.isArray(data)) {
          throw new Error(
            (data as { error?: string })?.error ?? "Unexpected response",
          );
        }
        setRows(data);
        const next: Record<ScheduleKind, FrequencyKey> = { ...EMPTY_DRAFT };
        for (const s of data) next[s.kind] = s.frequency;
        setDraft(next);
        baseline.current = { ...next };
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdUrl]);

  const dirty =
    !loading &&
    SCHEDULE_KINDS.some((k) => draft[k] !== baseline.current[k]);
  const estimated = SCHEDULE_KINDS.reduce(
    (sum, k) => sum + callsPerDay(k, draft[k]),
    0,
  );
  const rowByKind = new Map(rows.map((s) => [s.kind, s]));

  async function save() {
    setSaving(true);
    setError(null);
    const changed = SCHEDULE_KINDS.filter(
      (k) => draft[k] !== baseline.current[k],
    );
    try {
      for (const kind of changed) {
        const res = await fetch(
          `/api/accounts/${accountIdUrl}/schedules/${kind}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ frequency: draft[kind] }),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    // stopPropagation everywhere on the modal root: React events bubble
    // through the *component tree* not the DOM tree, so without this they
    // reach the parent <tr> (which has a row click that navigates to
    // /campaigns) — backdrop clicks and even dropdown clicks would otherwise
    // trigger the row link.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* Click-outside intentionally no-op — only Cancel/Save/ESC close.
          Stops accidental discards mid-edit. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedules-modal-title"
        className="w-full max-w-2xl rounded-lg border border-border bg-background shadow-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted" />
            <div>
              <h2
                id="schedules-modal-title"
                className="text-sm font-semibold tracking-tight"
              >
                Auto-sync schedules
              </h2>
              <p className="mt-0.5 text-xs text-muted">{accountName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading current schedules...
            </div>
          ) : (
            <>
              <p className="text-xs text-muted">
                Pick how often each sync runs for this account. Estimated{" "}
                <span className="font-medium text-foreground">
                  {estimated < 1
                    ? estimated.toFixed(1)
                    : Math.round(estimated)}{" "}
                  Meta API calls/day
                </span>
                .
              </p>

              <ul className="mt-3 divide-y divide-border">
                {SCHEDULE_KINDS.map((kind) => {
                  const r = rowByKind.get(kind);
                  const current = draft[kind];
                  const isOff = current === "off";
                  return (
                    <li
                      key={kind}
                      className="grid grid-cols-[1fr_auto_1fr_1fr] items-center gap-4 py-2.5 text-sm"
                    >
                      <span className="font-medium">{KIND_LABEL[kind]}</span>
                      <select
                        value={current}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [kind]: e.target.value as FrequencyKey,
                          }))
                        }
                        disabled={saving}
                        className={cn(
                          "rounded-md border border-border bg-background px-2.5 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
                          isOff && "text-muted",
                        )}
                      >
                        {FREQUENCY_PRESETS.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-xs text-muted">
                        Last:{" "}
                        <span className="text-foreground">
                          {formatRelative(r?.lastRunAt ?? null)}
                        </span>
                      </span>
                      <span className="text-xs text-muted">
                        {isOff ? (
                          "—"
                        ) : (
                          <>
                            Next:{" "}
                            <span className="text-foreground">
                              {formatRelative(r?.nextRunAt ?? null, {
                                future: true,
                              })}
                            </span>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {error && (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-[11px] text-subtle">
            Schedules fire only while the cron worker is running (
            <code className="rounded bg-surface px-1">npm run cron-worker</code>{" "}
            in dev).
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving || loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
