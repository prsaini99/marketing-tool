"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export type SyncKind = "campaigns" | "adsets" | "ads" | "insights";

interface SyncNowButtonProps {
  // Unprefixed metaAdAccountId — same shape used in the page URL.
  accountId: string;
  // One or more kinds. Multiple kinds are fired sequentially so we don't
  // hammer Meta with parallel requests against the same account.
  kinds: SyncKind[];
  label?: string;
  variant?: "secondary" | "primary";
  className?: string;
}

const STEP_LABEL: Record<SyncKind, string> = {
  campaigns: "campaigns",
  adsets: "ad sets",
  ads: "ads",
  insights: "insights",
};

export function SyncNowButton({
  accountId,
  kinds,
  variant = "secondary",
  className,
  label,
}: SyncNowButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<SyncKind | null>(null);

  async function handleSync() {
    if (kinds.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      for (const kind of kinds) {
        setStep(kind);
        const res = await fetch(`/api/sync/${accountId}/${kind}`, {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            `${STEP_LABEL[kind]} sync: ${data?.error ?? `HTTP ${res.status}`}`,
          );
        }
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLoading(false);
      setStep(null);
    }
  }

  const base =
    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-accent text-accent-foreground hover:bg-accent-hover"
      : "border border-border bg-background hover:bg-surface-2";

  const displayLabel = (() => {
    if (loading) {
      return step ? `Syncing ${STEP_LABEL[step]}...` : "Syncing...";
    }
    return label ?? "Sync now";
  })();

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        onClick={handleSync}
        disabled={loading || kinds.length === 0}
        className={cn(base, styles)}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {displayLabel}
      </button>
      {error && (
        <p className="max-w-xs text-right text-xs text-danger">{error}</p>
      )}
    </div>
  );
}
