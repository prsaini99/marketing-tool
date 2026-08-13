"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles, Tags } from "lucide-react";
import {
  ANGLE_LABELS,
  HOOK_LABELS,
  type CreativeAngle,
  type HookType,
} from "@/lib/creative-taxonomy";

/**
 * Creative pattern breakdown — what shapes of ad this account runs, and how
 * each shape actually performs.
 *
 * THE HONESTY RULE, and it is the whole design of this component: a tag
 * group only shows performance numbers when creatives in that group actually
 * spent money. Rendering "ROAS 0.00" for a group whose ads never ran reads
 * as a finding ("this hook fails!") when the truth is "we have no data".
 * That is the single easiest way for a tool like this to mislead the person
 * paying for it, so groups without spend are explicitly labelled "no
 * delivery data" and the footer says how many creatives have any at all.
 *
 * Counts, by contrast, are always meaningful — an account's creative mix is
 * a real fact even before a single impression. So the bar chart is driven by
 * creative count, and performance is supporting detail rather than the
 * headline.
 */

type Dimension = "hookType" | "angle" | "funnelStage";

interface TagGroup {
  key: string;
  creativeCount: number;
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenueCents: number;
  ctr: number;
  roas: number;
  cpaCents: number | null;
}

interface TagResponse {
  dimension: Dimension;
  groups: TagGroup[];
  untagged: number;
}

const DIMENSIONS: Array<{ key: Dimension; label: string }> = [
  { key: "hookType", label: "Hook" },
  { key: "angle", label: "Angle" },
  { key: "funnelStage", label: "Funnel stage" },
];

function labelFor(dimension: Dimension, key: string): string {
  if (dimension === "hookType") return HOOK_LABELS[key as HookType] ?? key;
  if (dimension === "angle") return ANGLE_LABELS[key as CreativeAngle] ?? key;
  return key;
}

function money(cents: number, currency: string): string {
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : "";
  return `${symbol}${Math.round(cents / 100).toLocaleString()}`;
}

export function CreativePatterns({
  adAccountId,
  currency = "INR",
}: {
  adAccountId: string;
  currency?: string;
}) {
  const [dimension, setDimension] = useState<Dimension>("hookType");
  const [data, setData] = useState<TagResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (dim: Dimension) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/ai/creative-tags?adAccountId=${encodeURIComponent(adAccountId)}&dimension=${dim}`,
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load patterns");
        setData(json as TagResponse);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load patterns");
      } finally {
        setLoading(false);
      }
    },
    [adAccountId],
  );

  useEffect(() => {
    void load(dimension);
  }, [dimension, load]);

  async function classify() {
    setClassifying(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/ai/creative-tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adAccountId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Classification failed");
      setNotice(
        json.classified > 0
          ? `Classified ${json.classified} creative${json.classified === 1 ? "" : "s"}.`
          : json.totalIndexed === 0
            ? "No indexed creatives yet. Run the ad-copy reindex first."
            : "Everything is already tagged.",
      );
      await load(dimension);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Classification failed");
    } finally {
      setClassifying(false);
    }
  }

  const groups = data?.groups ?? [];
  const maxCount = Math.max(1, ...groups.map((g) => g.creativeCount));
  const groupsWithSpend = groups.filter((g) => g.spendCents > 0);
  const totalCreatives = groups.reduce((s, g) => s + g.creativeCount, 0);

  return (
    <section className="rounded-lg border border-border">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Tags className="h-4 w-4 text-muted" />
          <div>
            <h2 className="text-sm font-semibold">Creative patterns</h2>
            <p className="text-xs text-muted">
              What shapes of ad this account runs (from copy, video
              transcripts and image analysis) and how each performs.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={classify}
          disabled={classifying}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-40"
        >
          {classifying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {classifying ? "Classifying…" : "Classify creatives"}
        </button>
      </header>

      <div className="flex gap-1 border-b border-border px-4 py-2">
        {DIMENSIONS.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setDimension(d.key)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              dimension === d.key
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="px-4 py-3">
        {loading && (
          <p className="py-6 text-center text-sm text-muted">Loading…</p>
        )}

        {!loading && error && <p className="py-4 text-sm text-danger">{error}</p>}

        {!loading && !error && groups.length === 0 && (
          <div className="py-6 text-center">
            <p className="text-sm text-muted">
              No classified creatives yet.
            </p>
            <p className="mt-1 text-xs text-muted">
              Creatives must be indexed for AI copy first, then classified.
            </p>
          </div>
        )}

        {!loading && !error && groups.length > 0 && (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2 font-medium">Pattern</th>
                  <th className="pb-2 text-right font-medium">Creatives</th>
                  <th className="pb-2 text-right font-medium">Spend</th>
                  <th className="pb-2 text-right font-medium">CTR</th>
                  <th className="pb-2 text-right font-medium">CPA</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const hasData = g.spendCents > 0;
                  return (
                    <tr key={g.key} className="border-t border-border">
                      <td className="py-2 pr-3">
                        <div className="font-medium">
                          {labelFor(dimension, g.key)}
                        </div>
                        {/* Count bar — always meaningful, unlike the metrics. */}
                        <div className="mt-1 h-1 w-full max-w-[160px] rounded bg-surface-2">
                          <div
                            className="h-1 rounded bg-accent"
                            style={{
                              width: `${(g.creativeCount / maxCount) * 100}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {g.creativeCount}
                      </td>
                      {hasData ? (
                        <>
                          <td className="py-2 text-right tabular-nums">
                            {money(g.spendCents, currency)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {(g.ctr * 100).toFixed(2)}%
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {g.cpaCents != null
                              ? money(g.cpaCents, currency)
                              : "-"}
                          </td>
                        </>
                      ) : (
                        <td
                          colSpan={3}
                          className="py-2 text-right text-xs text-muted"
                        >
                          no delivery data
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p className="mt-3 text-xs text-muted">
              {totalCreatives} creative{totalCreatives === 1 ? "" : "s"}{" "}
              classified
              {data && data.untagged > 0 && `, ${data.untagged} untagged`}.{" "}
              {groupsWithSpend.length === 0 ? (
                <>
                  None have delivery data yet, so no pattern can be compared on
                  performance. Sync insights to populate this.
                </>
              ) : (
                <>
                  {groupsWithSpend.length} of {groups.length} patterns have
                  delivery data; the rest never ran.
                </>
              )}
            </p>

            {notice && <p className="mt-2 text-xs text-success">{notice}</p>}
          </>
        )}
      </div>
    </section>
  );
}
