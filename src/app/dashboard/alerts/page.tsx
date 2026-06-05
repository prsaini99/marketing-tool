/**
 * Alerts — the daily anomaly digest landing.
 *
 * Server component renders the breadcrumb + header + initial list (loaded
 * server-side so the page lands rendered, not skeleton). The list itself
 * is the AlertsList client component which handles dismiss / scan-now and
 * calls router.refresh() so the sidebar badge in the layout re-queries.
 */

import { prisma } from "@/lib/db/prisma";
import { AlertsList, type AlertWithAccount } from "@/components/ai/alerts-list";
import { AlertsRulesInfo } from "@/components/ai/alerts-rules-info";

export const dynamic = "force-dynamic";

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { all } = await searchParams;
  const showDismissed = all === "1";
  const where = showDismissed ? {} : { dismissedAt: null };

  const rows = await prisma.alert.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      adAccount: {
        select: {
          metaAdAccountId: true,
          name: true,
          currency: true,
          business: { select: { id: true, name: true } },
        },
      },
    },
    take: 200,
  });

  // Coerce DB timestamps to ISO strings for the client component.
  const initialAlerts: AlertWithAccount[] = rows.map((r) => ({
    id: r.id,
    forDate: r.forDate.toISOString(),
    severity: r.severity,
    kind: r.kind,
    title: r.title,
    body: r.body,
    dismissedAt: r.dismissedAt ? r.dismissedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    adAccount: {
      metaAdAccountId: r.adAccount.metaAdAccountId,
      name: r.adAccount.name,
      currency: r.adAccount.currency,
      business: r.adAccount.business,
    },
  }));

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Alerts</h1>
          <AlertsRulesInfo />
        </div>
        <p className="mt-0.5 text-sm text-muted">
          Daily anomaly digest across every connected account — what shifted,
          why, and what to look at first. Generated automatically every
          morning; click <span className="font-medium">Run scan now</span> to
          regenerate on demand.
        </p>
      </div>

      <AlertsList
        initialAlerts={initialAlerts}
        initialShowDismissed={showDismissed}
      />
    </div>
  );
}
