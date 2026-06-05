/**
 * Reports — cross-account weekly performance reports.
 *
 * One row per ad account, filtered by the topbar client picker. Each row
 * has its own Generate button → inline expansion with the rendered
 * markdown + copy / download. Designed for the Monday-morning workflow:
 * sit down, knock out every client's report in one session.
 *
 * Per-account standalone page (/dashboard/accounts/[id]/reports) is still
 * accessible by direct URL if anyone bookmarked it.
 */

import { FileText } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import { ReportRow } from "@/components/ai/report-row";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client } = await searchParams;
  const selectedBusiness = client
    ? await prisma.metaBusiness.findUnique({
        where: { id: client },
        select: { id: true, name: true },
      })
    : null;

  const accounts = await prisma.metaAdAccount.findMany({
    where: {
      selectedForSync: true,
      ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
    },
    select: {
      metaAdAccountId: true,
      name: true,
      currency: true,
      business: { select: { name: true } },
    },
    distinct: ["metaAdAccountId"],
    orderBy: [{ business: { name: "asc" } }, { name: "asc" }],
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-0.5 text-sm text-muted">
          {selectedBusiness ? (
            <>
              AI-drafted weekly performance reports for{" "}
              <span className="text-foreground">{selectedBusiness.name}</span>
              &apos;s ad accounts.
            </>
          ) : (
            <>
              AI-drafted weekly performance reports across every client&apos;s
              ad accounts.
            </>
          )}{" "}
          Each row is a one-click narrative grounded in the last 7 days of
          synced insights.
        </p>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={
            selectedBusiness
              ? `No accounts under ${selectedBusiness.name}`
              : "No ad accounts selected for sync"
          }
          description="Pick accounts on the Accounts page and sync their insights, then come back here."
          action={{ label: "Go to Accounts", href: "/dashboard/accounts" }}
        />
      ) : (
        <div className="space-y-2.5">
          {accounts.map((a) => (
            <ReportRow
              key={a.metaAdAccountId}
              metaAdAccountId={a.metaAdAccountId}
              accountName={a.name}
              businessName={a.business.name}
              currency={a.currency}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-subtle">
        Each generation costs ~₹1–2 (LLM call). Reports are not cached — every
        click pulls fresh data.
      </p>
    </div>
  );
}
