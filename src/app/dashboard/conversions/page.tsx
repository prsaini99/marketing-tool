/**
 * Conversions library — every saved custom conversion across selected
 * ad accounts.
 *
 * A custom conversion is a rule on top of Pixel events ("Purchase value >
 * $100", "URL contains /thank-you", …) used as the optimization target on
 * conversion-objective ad sets. The agency builds these in Ads Manager;
 * we mirror them so:
 *   • the senior can audit which conversions exist per client
 *   • the Create Ad Set picker can offer them as targeting options
 *
 * Table view (same shape as Audiences) — the rule JSON is shown in a
 * `<details>` so the row stays scannable but the predicate is one click
 * away when senior wants to verify the exact match logic.
 */

import { Target } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchBar } from "@/components/ui/search-bar";
import { BulkSyncButton } from "@/components/sync/bulk-sync-button";

// Meta's custom_event_type values → human labels. The OTHER bucket catches
// anything URL-rule-based or custom-named.
const EVENT_LABEL: Record<string, string> = {
  PURCHASE: "Purchase",
  ADD_TO_CART: "Add to cart",
  INITIATE_CHECKOUT: "Initiate checkout",
  ADD_PAYMENT_INFO: "Add payment info",
  COMPLETE_REGISTRATION: "Complete registration",
  LEAD: "Lead",
  VIEW_CONTENT: "View content",
  ADD_TO_WISHLIST: "Add to wishlist",
  SUBSCRIBE: "Subscribe",
  CONTACT: "Contact",
  OTHER: "Custom rule",
};

function eventStyle(eventType: string | null): {
  pill: string;
  label: string;
} {
  if (!eventType) return { pill: "bg-zinc-100 text-zinc-600", label: "Unknown" };
  const label =
    EVENT_LABEL[eventType] ??
    eventType.charAt(0) + eventType.slice(1).toLowerCase().replace(/_/g, " ");
  if (eventType === "PURCHASE")
    return { pill: "bg-green-50 text-green-700", label };
  if (eventType === "LEAD")
    return { pill: "bg-blue-50 text-blue-700", label };
  if (eventType === "ADD_TO_CART" || eventType === "INITIATE_CHECKOUT")
    return { pill: "bg-amber-50 text-amber-700", label };
  if (eventType === "OTHER")
    return { pill: "bg-purple-50 text-purple-700", label };
  return { pill: "bg-zinc-100 text-zinc-700", label };
}

function formatRelative(d: Date | null): string {
  if (!d) return "—";
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)} days ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

// Pretty-print the rule JSON when possible — but fall back to raw string if
// Meta returns something that's already a one-liner or invalid JSON.
function formatRule(raw: string | null): string {
  if (!raw) return "(no rule)";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default async function ConversionsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; q?: string }>;
}) {
  const { client, q } = await searchParams;
  const query = q?.trim();
  const selectedBusiness = client
    ? await prisma.metaBusiness.findUnique({
        where: { id: client },
        select: { id: true, name: true },
      })
    : null;

  const rows = await prisma.customConversion.findMany({
    where: {
      adAccount: {
        selectedForSync: true,
        ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
      },
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { description: { contains: query, mode: "insensitive" } },
              { metaConversionId: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      adAccount: {
        select: {
          metaAdAccountId: true,
          name: true,
          business: { select: { name: true } },
        },
      },
    },
    orderBy: [{ adAccount: { name: "asc" } }, { name: "asc" }],
    take: 500,
  });

  const totalAcrossAll = await prisma.customConversion.count({
    where: { adAccount: { selectedForSync: true } },
  });

  const accountsInScope = await prisma.metaAdAccount.count({
    where: {
      selectedForSync: true,
      ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Conversions</h1>
          <p className="mt-0.5 text-sm text-muted">
            {selectedBusiness ? (
              <>
                {rows.length} saved conversions under{" "}
                <span className="text-foreground">{selectedBusiness.name}</span>
              </>
            ) : (
              <>
                {rows.length} saved conversions across all connected clients
              </>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <SearchBar placeholder="Search name, description or id…" />
          <BulkSyncButton
            kind="conversions"
            accountsInScope={accountsInScope}
            businessId={selectedBusiness?.id ?? null}
          />
        </div>
      </div>

      {totalAcrossAll === 0 ? (
        <EmptyState
          icon={Target}
          title="No custom conversions synced yet"
          description="Click Sync now above to pull every saved custom conversion from Meta for the selected accounts. They'll appear here and become pickable as the optimization goal on the Create Ad Set form."
        />
      ) : rows.length === 0 && query ? (
        <EmptyState
          icon={Target}
          title={`No conversions match “${query}”`}
          description="Try a shorter query, or clear the search to see all conversions."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Target}
          title={`No conversions under ${selectedBusiness?.name ?? "this client"}`}
          description="Switch clients in the top bar, or sync this client's ad accounts."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-subtle">
                <th className="px-4 py-2.5">Conversion</th>
                <th className="px-4 py-2.5">Event</th>
                <th className="px-4 py-2.5">Pixel</th>
                <th className="px-4 py-2.5">Last fired</th>
                <th className="px-4 py-2.5">Account</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => {
                const evStyle = eventStyle(c.customEventType);
                return (
                  <tr
                    key={c.id}
                    className="hover:bg-surface transition-colors"
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col">
                        <span
                          className="text-sm font-medium text-foreground"
                          title={c.name}
                        >
                          {c.name}
                        </span>
                        {c.description && (
                          <span
                            className="line-clamp-1 text-xs text-muted"
                            title={c.description}
                          >
                            {c.description}
                          </span>
                        )}
                        <span
                          className="font-mono text-[10px] text-subtle"
                          title={c.metaConversionId}
                        >
                          {c.metaConversionId}
                        </span>
                        {c.rule && (
                          <details className="mt-1.5">
                            <summary className="cursor-pointer text-[11px] text-muted hover:text-foreground">
                              View rule
                            </summary>
                            <pre className="mt-1 max-w-md overflow-x-auto rounded border border-border bg-surface p-2 text-[10px] leading-relaxed">
                              {formatRule(c.rule)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                          evStyle.pill,
                        )}
                      >
                        {evStyle.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top font-mono text-[11px] text-muted">
                      {c.eventSourceId ?? "—"}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-muted">
                      {formatRelative(c.metaLastFiredTime)}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-muted">
                      <div className="flex flex-col">
                        <span>{c.adAccount.business.name}</span>
                        <span className="text-subtle">
                          {c.adAccount.name}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-subtle">
        Showing up to 500 conversions. Conversions sync from Meta&apos;s
        /act_X/customconversions endpoint — pick one as the optimization
        target on conversion-objective ad sets via
        promoted_object.custom_conversion_id.
      </p>
    </div>
  );
}
