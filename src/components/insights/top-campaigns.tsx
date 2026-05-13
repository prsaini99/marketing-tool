import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { TopCampaignSpend } from "@/lib/display";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface TopCampaignsProps {
  items: TopCampaignSpend[];
  currency?: string;
  rangeLabel?: string;
  // Carry the current date range through to the drill-down so the user
  // lands on the same window they were just looking at.
  range?: string | null;
}

export function TopCampaigns({
  items,
  currency = "USD",
  rangeLabel = "last 7 days",
  range,
}: TopCampaignsProps) {
  return (
    <div className="rounded-lg border border-border bg-background p-5">
      <h3 className="text-sm font-semibold tracking-tight">Top campaigns</h3>
      <p className="mt-0.5 text-xs text-muted">
        By spend · {rangeLabel.toLowerCase()}
      </p>

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-subtle">
          No campaigns spent in this period.
        </p>
      ) : (
        <ol className="mt-5 space-y-0.5">
          {items.map((c, i) => {
            // Drill into the campaign's ad sets — most direct way to "see"
            // a campaign. Skip the link if we don't know the parent account
            // (data-quality fallback).
            const canLink = Boolean(c.adAccountIdUrl);
            const href = canLink
              ? `/dashboard/accounts/${c.adAccountIdUrl}/campaigns/${c.id}/adsets${
                  range ? `?range=${range}` : ""
                }`
              : "#";

            const body = (
              <>
                <span className="w-4 shrink-0 text-xs font-semibold tabular-nums text-subtle">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-subtle">
                    {c.businessName}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {formatMoney(c.spend, currency)}
                </span>
                {canLink && (
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </>
            );

            return (
              <li key={c.id}>
                {canLink ? (
                  <Link
                    href={href}
                    className="group flex items-baseline gap-3 rounded-md -mx-2 px-2 py-1.5 hover:bg-surface-2 transition-colors"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-baseline gap-3 px-2 py-1.5">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
