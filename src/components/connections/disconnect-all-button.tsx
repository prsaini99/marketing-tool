"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

interface DisconnectAllButtonProps {
  connectionCount: number;
}

export function DisconnectAllButton({
  connectionCount,
}: DisconnectAllButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    if (connectionCount === 0) return;
    const ok = window.confirm(
      `Disconnect ALL ${connectionCount} connection${
        connectionCount === 1 ? "" : "s"
      }?\n\nThis wipes every Meta access token plus every business, ad account, campaign, ad set, ad, and insight row in your local DB. You'll need to reconnect each business to resume management.`,
    );
    if (!ok) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/connections`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handle}
        disabled={loading || connectionCount === 0}
        className="inline-flex items-center rounded-md border border-red-300 bg-background px-2.5 py-1.5 text-sm font-medium text-danger hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {loading ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Disconnecting...
          </span>
        ) : (
          "Disconnect all"
        )}
      </button>
      {error && (
        <p className="max-w-xs text-right text-xs text-danger">{error}</p>
      )}
    </div>
  );
}
