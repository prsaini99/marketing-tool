"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

interface SyncAllInsightsButtonProps {
  // Unprefixed metaAdAccountIds (URL form), one per selected ad account.
  accountIds: string[];
}

export function SyncAllInsightsButton({
  accountIds,
}: SyncAllInsightsButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);

  async function handle() {
    setLoading(true);
    setError(null);
    setDone(0);
    try {
      // Sequential — keeps Meta load predictable. With ~10 accounts each
      // taking a few seconds, total is in the tens-of-seconds range.
      for (let i = 0; i < accountIds.length; i++) {
        const res = await fetch(`/api/sync/${accountIds[i]}/insights`, {
          method: "POST",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error ?? `HTTP ${res.status}`);
        }
        setDone(i + 1);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  const label = loading
    ? `Syncing ${done}/${accountIds.length}...`
    : "Sync all insights";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handle}
        disabled={loading || accountIds.length === 0}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
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
    </div>
  );
}
