/**
 * Account audit page — one-click housekeeping audit per account.
 *
 * Server component renders the breadcrumb + header, then hands off to
 * AuditPanel which runs the four checks (budget / naming / URL+UTM /
 * voice drift) and shows the prioritised findings. Audit is generated
 * on-demand (no persistence) — cheap to re-run and the strategist
 * usually wants the latest view.
 */

import Link from "next/link";
import { ChevronRight, ClipboardCheck } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import { AuditPanel } from "@/components/ai/audit-panel";
import { getLatestAuditForAccount } from "@/server/services/ai/audit-account";

export const dynamic = "force-dynamic";

export default async function AuditPage({
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
          icon={ClipboardCheck}
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
        <span className="text-foreground">Audit</span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit</h1>
        <p className="mt-0.5 text-sm text-muted">
          One-click housekeeping audit for{" "}
          <span className="text-foreground">{account.name}</span> ·{" "}
          {account.business.name}. Scans budget allocation, naming, URL/UTM
          tracking, and brand-voice drift — the things humans skim past.
        </p>
      </div>

      <AuditPanel
        metaAdAccountId={account.metaAdAccountId}
        accountName={account.name}
        initialResult={await getLatestAuditForAccount(account.metaAdAccountId)}
      />
    </div>
  );
}
