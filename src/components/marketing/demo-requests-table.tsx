"use client";

/**
 * Inbound demo requests, with triage.
 *
 * EVERY STRING HERE IS ATTACKER-SUPPLIED. These rows are the only records in
 * the product written by anonymous callers, so nothing is rendered as HTML
 * and nothing is passed to an href unescaped. React's default text escaping
 * is doing real work on this screen rather than being incidental.
 */

import { useState } from "react";
import { Mail, Loader2 } from "lucide-react";
import { DEMO_STATUSES, type DemoStatus } from "@/lib/demo-request";
import { cn } from "@/lib/utils";

export interface DemoRequestRow {
  id: string;
  name: string;
  email: string;
  company: string | null;
  monthlySpend: string | null;
  message: string | null;
  source: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  referrer: string | null;
  status: string;
  createdAt: string;
}

const STATUS_STYLE: Record<string, string> = {
  NEW: "bg-accent-subtle text-accent",
  CONTACTED: "bg-blue-50 text-blue-700",
  QUALIFIED: "bg-success-subtle text-success",
  ARCHIVED: "bg-zinc-100 text-zinc-600",
};

export function DemoRequestsTable({ rows }: { rows: DemoRequestRow[] }) {
  const [items, setItems] = useState(rows);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<DemoStatus | "ALL">("ALL");

  async function setStatus(id: string, status: DemoStatus) {
    setBusy(id);
    // Optimistic: the update is a single column and the row is already on
    // screen. A failure rolls back below.
    const previous = items;
    setItems((cur) => cur.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      const res = await fetch(`/api/demo-requests/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) setItems(previous);
    } catch {
      setItems(previous);
    } finally {
      setBusy(null);
    }
  }

  const shown = filter === "ALL" ? items : items.filter((r) => r.status === filter);
  const countFor = (s: DemoStatus) => items.filter((r) => r.status === s).length;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {(["ALL", ...DEMO_STATUSES] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              filter === s
                ? "bg-accent text-accent-foreground"
                : "border border-border text-muted hover:text-foreground",
            )}
          >
            {s === "ALL" ? `All ${items.length}` : `${s.charAt(0)}${s.slice(1).toLowerCase()} ${countFor(s)}`}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border bg-surface px-5 py-10 text-center text-[15px] text-muted">
          Nothing here yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {shown.map((r) => (
            <li key={r.id} className="rounded-xl border border-border bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">
                    {r.name}
                    {r.company && (
                      <span className="font-normal text-muted"> · {r.company}</span>
                    )}
                  </p>
                  <a
                    href={`mailto:${encodeURIComponent(r.email)}`}
                    className="mt-0.5 inline-flex items-center gap-1.5 text-[14px] text-accent hover:underline"
                  >
                    <Mail className="h-3.5 w-3.5" aria-hidden />
                    {r.email}
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                      STATUS_STYLE[r.status] ?? "bg-zinc-100 text-zinc-600",
                    )}
                  >
                    {r.status}
                  </span>
                  <span className="text-[12px] text-subtle">
                    {new Date(r.createdAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>

              {r.monthlySpend && (
                <p className="mt-2 text-[13px] text-muted">
                  Spend: <span className="text-foreground">{r.monthlySpend}</span>
                </p>
              )}
              {r.message && (
                <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-muted">
                  {r.message}
                </p>
              )}

              {/* Attribution. The reason the SEO pages are justifiable or not. */}
              <p className="mt-3 text-[12px] text-subtle">
                {r.source ? `Landed on ${r.source}` : "Source unknown"}
                {r.utmSource ? ` · utm ${r.utmSource}` : ""}
                {r.utmCampaign ? ` / ${r.utmCampaign}` : ""}
                {r.referrer ? ` · from ${r.referrer}` : ""}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {busy === r.id && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-subtle" aria-hidden />
                )}
                {DEMO_STATUSES.filter((s) => s !== r.status).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(r.id, s)}
                    className="rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-muted hover:text-foreground"
                  >
                    Mark {s.toLowerCase()}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
