"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { DisplayAdAccount } from "@/lib/display";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

const STATUS_CONFIG: Record<
  DisplayAdAccount["status"],
  { pill: string; dot: string; label: string }
> = {
  ACTIVE: {
    pill: "bg-green-50 text-green-700",
    dot: "bg-green-500",
    label: "Active",
  },
  DISABLED: {
    pill: "bg-zinc-100 text-zinc-600",
    dot: "bg-zinc-400",
    label: "Disabled",
  },
  UNSETTLED: {
    pill: "bg-amber-50 text-amber-700",
    dot: "bg-amber-500",
    label: "Unsettled",
  },
  PENDING_REVIEW: {
    pill: "bg-blue-50 text-blue-700",
    dot: "bg-blue-500",
    label: "Pending review",
  },
  CLOSED: {
    pill: "bg-zinc-100 text-zinc-600",
    dot: "bg-zinc-400",
    label: "Closed",
  },
};

function StatusPill({ status }: { status: DisplayAdAccount["status"] }) {
  const c = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        c.pill,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
}

interface AccountsTableProps {
  accounts: DisplayAdAccount[];
}

export function AccountsTable({ accounts }: AccountsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = searchParams.get("range");
  const querySuffix = range ? `?range=${range}` : "";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-subtle">
            <th className="px-4 py-2.5">Account</th>
            <th className="px-4 py-2.5 text-right">Spend</th>
            <th className="px-4 py-2.5 text-right">Active campaigns</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Last sync</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {accounts.map((a) => {
            const href = `/dashboard/accounts/${a.id.replace("act_", "")}${querySuffix}`;
            return (
              <tr
                key={a.id}
                role="link"
                tabIndex={0}
                onClick={() => router.push(href)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(href);
                  }
                }}
                className="group cursor-pointer hover:bg-surface focus-visible:bg-surface focus-visible:outline-none transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{a.name}</span>
                    <span className="text-xs text-subtle">
                      {a.businessName} · {a.id}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-sm font-medium tabular-nums">
                  {a.spend7d != null ? (
                    formatMoney(a.spend7d, a.currency)
                  ) : (
                    <span className="font-normal text-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {a.activeCampaigns != null ? (
                    a.activeCampaigns
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={a.status} />
                </td>
                <td className="px-4 py-3 text-sm text-muted">
                  {a.lastSync ?? (
                    <span className="text-subtle">Not synced</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
