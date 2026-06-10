/**
 * Reports — auto-drafted weekly performance summaries for one ad account.
 *
 * Server component shell: resolves the account, renders the breadcrumb +
 * header, hands off to the client panel which does the actual generation
 * (POST /api/ai/reports/weekly) and markdown rendering.
 *
 * Phase-2 ideas (not built): scheduled email delivery, monthly variant,
 * client-portal share link, history of past reports.
 */

import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import { WeeklyReportPanel } from "@/components/ai/weekly-report-panel";

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const fullAccountId = `act_${id}`;

  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId: fullAccountId, selectedForSync: true },
    include: { business: true },
  });

  if (!account) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={FileText}
          title="Ad account not found"
          description="This ad account isn't currently selected for sync."
          action={{
            label: "Manage connections",
            href: "/dashboard/connect-business",
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-xs text-muted">
        <Link href="/dashboard/accounts" className="hover:text-foreground">
          Accounts
        </Link>
        <ChevronRight className="h-3 w-3 text-subtle" />
        <Link
          href={`/dashboard/accounts/${id}`}
          className="hover:text-foreground"
        >
          {account.name}
        </Link>
        <ChevronRight className="h-3 w-3 text-subtle" />
        <span className="text-foreground">Reports</span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-0.5 text-sm text-muted">
          AI-drafted weekly performance summary for{" "}
          <span className="text-foreground">{account.name}</span> ·{" "}
          {account.business.name}
        </p>
      </div>

      <WeeklyReportPanel
        metaAdAccountId={account.metaAdAccountId}
        accountName={account.name}
        currency={account.currency}
      />
    </div>
  );
}
