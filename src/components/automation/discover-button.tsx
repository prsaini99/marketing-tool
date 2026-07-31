"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";

export function DiscoverButton({ connectionIds }: { connectionIds: string[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    let found = 0;
    let failed = 0;
    for (const id of connectionIds) {
      try {
        const res = await fetch("/api/automation/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connectionId: id }),
        });
        const data = (await res.json()) as { found?: number };
        if (res.ok) found += data.found ?? 0;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    setResult(
      failed > 0
        ? `Found ${found} account(s); ${failed} connection(s) failed (check token scopes)`
        : `Found ${found} account(s)`,
    );
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={run}
        disabled={loading || connectionIds.length === 0}
        className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Discover accounts
      </button>
      {result && <span className="text-sm text-muted-foreground">{result}</span>}
    </div>
  );
}
