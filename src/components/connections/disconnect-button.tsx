"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Unplug } from "lucide-react";

interface DisconnectButtonProps {
  connectionId: string;
  connectionLabel: string; // shown in the confirm prompt
}

export function DisconnectButton({
  connectionId,
  connectionLabel,
}: DisconnectButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    const ok = window.confirm(
      `Disconnect "${connectionLabel}"?\n\nThis revokes the local access token and deletes every business, ad account, campaign, ad set, ad, and insight row tied to this connection. You'll need to reconnect to sync again.`,
    );
    if (!ok) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/connections/${connectionId}`, {
        method: "DELETE",
      });
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
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Unplug className="h-3 w-3" />
        )}
        {loading ? "Disconnecting..." : "Disconnect"}
      </button>
      {error && (
        <p className="max-w-xs text-right text-xs text-danger">{error}</p>
      )}
    </div>
  );
}
