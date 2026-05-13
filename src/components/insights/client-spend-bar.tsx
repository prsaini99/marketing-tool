import type { ClientSpend } from "@/lib/display";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface ClientSpendBarProps {
  items: ClientSpend[];
  currency?: string;
  rangeLabel?: string;
}

export function ClientSpendBar({
  items,
  currency = "USD",
  rangeLabel = "Last 7 days",
}: ClientSpendBarProps) {
  return (
    <div className="rounded-lg border border-border bg-background p-5">
      <h3 className="text-sm font-semibold tracking-tight">Spend by client</h3>
      <p className="mt-0.5 text-xs text-muted">{rangeLabel}</p>

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-subtle">No spend in this period.</p>
      ) : (
        <div className="mt-5 space-y-4">
          {items.map((c) => (
            <div key={c.businessId}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="tabular-nums text-muted">
                  {formatMoney(c.spend, currency)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${c.share * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
