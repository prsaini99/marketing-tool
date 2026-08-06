import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { getSessionRole, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Which role the session cookie belongs to — drives which sidebar entries
  // render for a restricted reviewer session (see Sidebar). Middleware has
  // already verified the cookie is valid for this request to even reach
  // here; this just needs the role, not another validity check.
  const cookieStore = await cookies();
  const role = await getSessionRole(cookieStore.get(SESSION_COOKIE)?.value);

  // Businesses with at least one ad account selected for sync.
  // The switcher uses this to populate the dropdown; pages filter by it.
  const businesses = await prisma.metaBusiness.findMany({
    where: {
      connection: { status: { not: "REVOKED" } },
      adAccounts: { some: { selectedForSync: true } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Lookup map for derive-business-from-path. Only selected accounts —
  // drilling into a non-selected account should not change the switcher.
  const selectedAccounts = await prisma.metaAdAccount.findMany({
    where: { selectedForSync: true },
    select: { metaAdAccountId: true, businessId: true },
  });
  const accountToBusiness: Record<string, string> = {};
  for (const a of selectedAccounts) {
    accountToBusiness[a.metaAdAccountId] = a.businessId;
  }

  // Undismissed-alerts badge in the sidebar. Layout is force-dynamic so this
  // re-runs on every navigation — fresh count after dismissing without
  // needing client polling.
  const alertCount = await prisma.alert.count({
    where: { dismissedAt: null },
  });

  // "Needs attention" badge on the Automation entry — flagged bot threads,
  // across all accounts, that haven't been resolved yet. Layout is
  // force-dynamic so this re-runs on every navigation; the inbox page's
  // router.refresh() after resolving/flagging a thread re-renders this
  // layout too, so the badge stays current without any client polling.
  const needsAttentionCount = await prisma.botThread.count({
    where: { flagReason: { not: null }, resolvedAt: null },
  });

  // A reviewer can reach only two pages, and two links stranded at the top of
  // a full-height sidebar make the product look half-built — which is the
  // wrong impression for the one audience that sees this view. Drop the
  // sidebar for them and let Topbar carry the nav horizontally instead.
  const isReviewer = role === "reviewer";

  return (
    <div className="flex min-h-screen">
      {!isReviewer && (
        <Sidebar
          accountToBusiness={accountToBusiness}
          alertCount={alertCount}
          needsAttentionCount={needsAttentionCount}
          role={role ?? undefined}
        />
      )}
      <div className="flex flex-1 flex-col">
        <Topbar
          businesses={businesses}
          accountToBusiness={accountToBusiness}
          role={role ?? undefined}
        />
        <main className="flex-1 px-6 py-5">{children}</main>
      </div>
    </div>
  );
}
