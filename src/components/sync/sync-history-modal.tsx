"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CircleDot, Clock, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SyncLog {
  id: string;
  kind: string;
  status: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface SyncHistoryModalProps {
  open: boolean;
  // Pre-loaded logs, passed in by the server component. Avoids a round-trip
  // when opening the modal — keeps it snappy. Caller refreshes on close.
  logs: SyncLog[];
  onClose: () => void;
}

const SYNC_KIND_LABEL: Record<string, string> = {
  campaigns: "Campaigns",
  adsets: "Ad sets",
  ads: "Ads",
  insights: "Insights",
  discovery: "Discovery",
};

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)} days ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(d);
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1_000)}s`;
}

export function SyncHistoryModal({ open, logs, onClose }: SyncHistoryModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-history-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl rounded-lg border border-border bg-background shadow-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted" />
            <div>
              <h2
                id="sync-history-title"
                className="text-sm font-semibold tracking-tight"
              >
                Recent sync history
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                Latest 10 sync attempts for this account.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {logs.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-subtle">
              No sync runs yet. Use Sync now to populate.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-subtle">
                    <th className="px-4 py-2.5">Kind</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Started</th>
                    <th className="px-4 py-2.5">Duration</th>
                    <th className="px-4 py-2.5">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.map((l) => (
                    <tr key={l.id} className="hover:bg-surface transition-colors">
                      <td className="px-4 py-2.5 text-sm font-medium">
                        {SYNC_KIND_LABEL[l.kind] ?? l.kind}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            l.status === "success"
                              ? "bg-green-50 text-green-700"
                              : l.status === "running"
                                ? "bg-blue-50 text-blue-700"
                                : "bg-red-50 text-red-700",
                          )}
                        >
                          {l.status === "running" ? (
                            <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                          ) : (
                            <CircleDot
                              className={cn(
                                "h-3 w-3",
                                l.status === "success"
                                  ? "text-green-500"
                                  : "text-red-500",
                              )}
                            />
                          )}
                          {l.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted">
                        {formatRelative(l.startedAt)}
                      </td>
                      <td className="px-4 py-2.5 text-xs tabular-nums text-muted">
                        {formatDuration(l.startedAt, l.finishedAt)}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {l.error ? (
                          <span
                            className="line-clamp-1 text-danger"
                            title={l.error}
                          >
                            {l.error}
                          </span>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
