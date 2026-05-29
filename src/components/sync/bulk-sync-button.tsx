"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Page-scoped, sequential bulk-sync button.
 *
 * Used on the flat list pages (Campaigns, Creatives, …) to refresh just that
 * page's entity type across whatever scope the user has filtered to. Always
 * hits `/api/sync/<kind>?client=<businessId>` which loops accounts in series
 * server-side — never parallel — so we never burst Meta's per-token limits
 * regardless of how many accounts the user has selected.
 *
 * Label is intentionally compact ("Sync now (5)") because these pages already
 * carry a busy toolbar (Search + Date range + Export + New …).
 */

export type BulkSyncKind =
  | "campaigns"
  | "creatives"
  | "images"
  | "videos"
  | "audiences"
  | "conversions";

interface BulkSyncButtonProps {
  kind: BulkSyncKind;
  // Number of selected-for-sync accounts the click will hit. Shown in the
  // label so the user knows the blast radius before pressing.
  accountsInScope: number;
  // Optional MetaBusiness DB id; forwarded as ?client= to scope the bulk
  // route to one client. Null/undefined → sync every selected account.
  businessId: string | null;
}

interface BulkSyncResponse {
  accounts: number;
  succeeded: number;
  failed: number;
}

export function BulkSyncButton({
  kind,
  accountsInScope,
  businessId,
}: BulkSyncButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Compact "synced N of M" summary surfaced right under the button so a
  // partial failure is visible without opening Sync history.
  const [summary, setSummary] = useState<{
    succeeded: number;
    accounts: number;
    failed: number;
  } | null>(null);

  async function handleSync() {
    if (accountsInScope === 0) return;
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const qs = businessId ? `?client=${encodeURIComponent(businessId)}` : "";
      const res = await fetch(`/api/sync/${kind}${qs}`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as
        | BulkSyncResponse
        | { error?: string };
      if (!res.ok) {
        throw new Error(
          ("error" in data && data.error) || `HTTP ${res.status}`,
        );
      }
      const body = data as BulkSyncResponse;
      setSummary({
        succeeded: body.succeeded,
        accounts: body.accounts,
        failed: body.failed,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  const label = (() => {
    if (loading) {
      return accountsInScope === 1
        ? "Syncing 1..."
        : `Syncing ${accountsInScope}...`;
    }
    if (accountsInScope === 0) return "Sync now (0)";
    return `Sync now (${accountsInScope})`;
  })();

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleSync}
        disabled={loading || accountsInScope === 0}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {label}
      </button>
      {error && (
        <p className="max-w-xs text-right text-xs text-danger">{error}</p>
      )}
      {summary && !error && (
        <p
          className={cn(
            "text-right text-xs",
            summary.failed === 0 ? "text-muted" : "text-amber-700",
          )}
        >
          {summary.failed === 0
            ? `Synced ${summary.succeeded} of ${summary.accounts}`
            : `Synced ${summary.succeeded}, failed ${summary.failed}`}
        </p>
      )}
    </div>
  );
}
