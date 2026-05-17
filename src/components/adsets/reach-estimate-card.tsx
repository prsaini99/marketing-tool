"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Live audience-size readout for the Create Ad Set modal.
 *
 * Watches the targeting JSON + optimization goal that the form would
 * otherwise POST, debounces 500ms, then hits /api/reach-estimate which
 * routes through Meta's /act_X/delivery_estimate. Renders the result as
 * a "1.2M – 1.4M people" range, with explicit loading / error / not-ready
 * states so the user always knows whether the number they see is current.
 *
 * Why debounce: every keystroke in the countries / age inputs would
 * otherwise burn a Meta call. 500ms is the same delay our search bar uses
 * and is what Meta's own Ads Manager UI ships with.
 *
 * Why a ref-stored last-key: React 18 strict mode runs effects twice in
 * dev, and rapid typing produces stale-callback risk. We track the latest
 * "intended" request key and discard responses whose key no longer matches
 * — classic abort-by-key pattern, cheaper than AbortController for this.
 */

interface ReachEstimateCardProps {
  metaAdAccountId: string;          // act_-prefixed or unprefixed
  targeting: Record<string, unknown> | null;
  optimizationGoal: string;
  // The form decides whether the inputs are valid enough to estimate
  // (e.g. countries must be non-empty). When false we render a small
  // "Fill the targeting fields to see an estimate" placeholder instead
  // of firing a doomed call.
  enabled: boolean;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; lowerBound: number; upperBound: number; ready: boolean }
  | { kind: "error"; message: string };

function formatCompact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

export function ReachEstimateCard({
  metaAdAccountId,
  targeting,
  optimizationGoal,
  enabled,
}: ReachEstimateCardProps) {
  const [state, setState] = useState<State>({ kind: "idle" });
  // Track the "intent key" of the latest request the effect issued. When
  // the fetch resolves we compare against this — if the user has typed
  // more in the meantime, the response is stale and discarded.
  const latestKeyRef = useRef<string>("");

  // Build a stable serialized key. JSON.stringify is fine for this size
  // (the targeting object never has more than ~kilobytes of payload).
  const targetingKey = targeting ? JSON.stringify(targeting) : "";
  const requestKey = `${metaAdAccountId}::${optimizationGoal}::${targetingKey}`;

  useEffect(() => {
    if (!enabled || !targeting) {
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "loading" });
    latestKeyRef.current = requestKey;
    const myKey = requestKey;

    const timer = setTimeout(() => {
      // Re-check we're still the latest after the debounce window.
      if (latestKeyRef.current !== myKey) return;
      fetch("/api/reach-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metaAdAccountId,
          targeting,
          optimizationGoal,
        }),
      })
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as {
            lowerBound?: number;
            upperBound?: number;
            ready?: boolean;
            error?: string;
          };
          // Drop stale responses — user has typed more by now.
          if (latestKeyRef.current !== myKey) return;
          if (!res.ok) {
            setState({
              kind: "error",
              message: data.error ?? `HTTP ${res.status}`,
            });
            return;
          }
          setState({
            kind: "ok",
            lowerBound: data.lowerBound ?? 0,
            upperBound: data.upperBound ?? 0,
            ready: data.ready ?? false,
          });
        })
        .catch((err: unknown) => {
          if (latestKeyRef.current !== myKey) return;
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "Failed",
          });
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [requestKey, enabled, targeting, optimizationGoal, metaAdAccountId]);

  return (
    <div className="rounded-md border border-border bg-background px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle">
        <Users className="h-3 w-3" />
        Estimated audience size
      </div>
      <div className="mt-1.5">
        {state.kind === "idle" && (
          <p className="text-xs text-muted">
            Fill the targeting fields to see Meta&apos;s reach estimate.
          </p>
        )}
        {state.kind === "loading" && (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            Computing…
          </p>
        )}
        {state.kind === "ok" && (
          <>
            {state.ready ? (
              <p className="text-base font-semibold tabular-nums text-foreground">
                {formatCompact(state.lowerBound)}
                <span className="mx-1 text-subtle">–</span>
                {formatCompact(state.upperBound)}
                <span className="ml-1 text-xs font-normal text-muted">
                  people
                </span>
              </p>
            ) : (
              <p className="text-xs text-amber-700">
                Meta is still computing the estimate for this targeting —
                try again in a moment.
              </p>
            )}
            <p
              className={cn(
                "mt-0.5 text-[11px]",
                state.ready ? "text-subtle" : "text-subtle",
              )}
            >
              Live from{" "}
              <span className="font-mono">/act_X/delivery_estimate</span>.
            </p>
          </>
        )}
        {state.kind === "error" && (
          <p className="text-xs text-danger">{state.message}</p>
        )}
      </div>
    </div>
  );
}
