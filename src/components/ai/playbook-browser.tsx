"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  Loader2,
  Search,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Playbook browser — client-side filter UI + result rendering.
 *
 * Server page hands us the initial entries from /api/ai/playbook based on
 * URL searchParams. We mirror those into local state so refilters / search
 * / metric changes can refetch without a full navigation. URL stays in
 * sync (router.replace) so the view is shareable + refresh-safe.
 *
 * Filters intentionally minimal — Metric, free-form semantic search,
 * (client filter lives in the topbar like every other page).
 */

export interface PlaybookEntry {
  id: string;
  sourceId: string;
  content: string;
  callToActionType: string | null;
  perf: {
    spendCents: number;
    revenueCents: number;
    conversionsCount: number;
    ctr: number;
    roas: number;
  };
  account: {
    name: string;
    metaAdAccountId: string;
    business: { id: string; name: string };
  } | null;
}

export interface PlaybookStats {
  accountsRepresented: number;
  avgRoas: number;
}

interface PlaybookBrowserProps {
  initialEntries: PlaybookEntry[];
  initialStats: PlaybookStats;
  initialMetric: "roas" | "conversions" | "ctr" | "spend";
  initialQuery: string;
}

type Metric = "roas" | "conversions" | "ctr" | "spend";

const METRIC_LABEL: Record<Metric, string> = {
  roas: "ROAS",
  conversions: "Conversions",
  ctr: "CTR",
  spend: "Spend",
};

function fmtMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  });
}

export function PlaybookBrowser({
  initialEntries,
  initialStats,
  initialMetric,
  initialQuery,
}: PlaybookBrowserProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [entries, setEntries] = useState(initialEntries);
  const [stats, setStats] = useState(initialStats);
  const [metric, setMetric] = useState<Metric>(initialMetric);
  const [query, setQuery] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchEntries(opts: {
    metric: Metric;
    query: string;
    pushUrl: boolean;
  }) {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      // Preserve the client filter from the topbar.
      const client = searchParams.get("client");
      if (client) params.set("client", client);
      params.set("metric", opts.metric);
      if (opts.query.trim()) params.set("q", opts.query.trim());

      const res = await fetch(`/api/ai/playbook?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);

      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setStats(
        data.stats ?? {
          accountsRepresented: 0,
          avgRoas: 0,
        },
      );

      if (opts.pushUrl) {
        const pageParams = new URLSearchParams(searchParams.toString());
        pageParams.set("metric", opts.metric);
        if (opts.query.trim()) pageParams.set("q", opts.query.trim());
        else pageParams.delete("q");
        router.replace(`/dashboard/playbook?${pageParams.toString()}`, {
          scroll: false,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setBusy(false);
    }
  }

  // Re-fetch when client filter changes (topbar switch).
  const clientFromUrl = searchParams.get("client") ?? "";
  useEffect(() => {
    fetchEntries({ metric, query, pushUrl: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFromUrl]);

  function onSubmitQuery(e: React.FormEvent) {
    e.preventDefault();
    fetchEntries({ metric, query, pushUrl: true });
  }

  function onChangeMetric(next: Metric) {
    setMetric(next);
    fetchEntries({ metric: next, query, pushUrl: true });
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-border bg-background px-4 py-3">
        <form onSubmit={onSubmitQuery} className="flex flex-1 items-center gap-2 min-w-[280px]">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search hooks, e.g. 'free shipping', 'limited edition', 'discount'…"
              disabled={busy}
              className="w-full rounded-md border border-border bg-background pl-7 pr-2 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Search
          </button>
        </form>

        <div className="flex items-center gap-2 text-xs">
          <label className="text-muted">Best by:</label>
          <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
            {(["roas", "conversions", "ctr", "spend"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChangeMetric(m)}
                disabled={busy}
                className={cn(
                  "rounded-sm px-2 py-0.5 font-medium transition-colors",
                  metric === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted hover:text-foreground",
                )}
              >
                {METRIC_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <BookOpen className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{entries.length}</span>{" "}
          winners
        </span>
        <span>
          across{" "}
          <span className="font-medium text-foreground">
            {stats.accountsRepresented}
          </span>{" "}
          account{stats.accountsRepresented === 1 ? "" : "s"}
        </span>
        {stats.avgRoas > 0 && (
          <span className="inline-flex items-center gap-1">
            <TrendingUp className="h-3.5 w-3.5" />
            Avg ROAS{" "}
            <span className="font-medium text-foreground">
              {stats.avgRoas.toFixed(2)}×
            </span>
          </span>
        )}
        {query && (
          <span className="text-subtle">
            (semantically ranked by &ldquo;{query}&rdquo; × performance)
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {/* Results */}
      {busy && entries.length === 0 ? (
        <div className="flex items-center justify-center rounded-md border border-dashed border-border bg-surface px-4 py-12 text-xs text-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-surface px-6 py-12 text-center text-sm text-muted">
          <BookOpen className="mx-auto h-7 w-7 text-subtle" />
          <p className="mt-2 font-medium text-foreground">
            No winners yet for this filter
          </p>
          <p className="mt-1 text-xs">
            The Playbook only shows ads with real spend (≥ ₹500) or
            conversions. Sync more accounts and let insights land, then
            check back.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {entries.map((e) => (
            <li
              key={e.id}
              className="space-y-2 rounded-md border border-border bg-background p-4"
            >
              {/* Perf chips */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {e.perf.roas > 0 && (
                  <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 font-semibold text-green-700">
                    ROAS {e.perf.roas.toFixed(2)}×
                  </span>
                )}
                {e.perf.conversionsCount > 0 && (
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
                    {e.perf.conversionsCount} conv
                  </span>
                )}
                {e.perf.ctr > 0 && (
                  <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700">
                    CTR {(e.perf.ctr * 100).toFixed(2)}%
                  </span>
                )}
                {e.perf.spendCents > 0 && (
                  <span className="text-subtle">
                    · ₹{fmtMoney(e.perf.spendCents)} spend
                  </span>
                )}
              </div>

              {/* Source */}
              {e.account && (
                <div className="text-[11px] text-muted">
                  <span className="font-medium text-foreground">
                    {e.account.business.name}
                  </span>
                  {" · "}
                  {e.account.name}
                </div>
              )}

              {/* Copy */}
              <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-3 text-xs leading-6 text-foreground font-sans">
                {e.content}
              </pre>

              {/* CTA */}
              {e.callToActionType && (
                <div className="text-[11px] text-subtle">
                  CTA:{" "}
                  <span className="font-mono text-foreground">
                    {e.callToActionType}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
