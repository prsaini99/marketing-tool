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

  // The four reads below fire on EVERY navigation (force-dynamic layout).
  // They are independent, so they run as one parallel batch — sequential
  // awaits here meant four database round trips stacked end-to-end before
  // any page could even begin rendering, which was the single largest
  // constant tax on navigation.
  const [
    businesses,
    selectedAccounts,
    alertCount,
    needsAttentionCount,
    demoRequestCount,
  ] =
    await Promise.all([
      // Switcher dropdown: businesses with at least one synced account.
      prisma.metaBusiness.findMany({
        where: {
          connection: { status: { not: "REVOKED" } },
          adAccounts: { some: { selectedForSync: true } },
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      // Lookup map for derive-business-from-path. Only selected accounts —
      // drilling into a non-selected account should not change the switcher.
      prisma.metaAdAccount.findMany({
        where: { selectedForSync: true },
        select: { metaAdAccountId: true, businessId: true },
      }),
      // Undismissed-alerts badge. Re-runs per navigation so it is fresh
      // after a dismiss without client polling.
      prisma.alert.count({ where: { dismissedAt: null } }),
      // "Needs attention" badge — flagged, unresolved bot threads.
      prisma.botThread.count({
        where: { flagReason: { not: null }, resolvedAt: null },
      }),
      // Uncontacted demo requests. A lead sitting unnoticed is the most
      // expensive thing this dashboard can fail to surface.
      prisma.demoRequest.count({ where: { status: "NEW" } }),
    ]);
  const accountToBusiness: Record<string, string> = {};
  for (const a of selectedAccounts) {
    accountToBusiness[a.metaAdAccountId] = a.businessId;
  }

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
          demoRequestCount={demoRequestCount}
          role={role ?? undefined}
        />
      )}
      <div className="flex flex-1 flex-col">
        <Topbar
          businesses={businesses}
          accountToBusiness={accountToBusiness}
          role={role ?? undefined}
        />
        <main className="flex-1 px-6 py-5">
          {/* keyed remount per navigation is unnecessary — loading.tsx swaps
              in between routes, so the rise plays on each page stream-in. */}
          <div className="rise-in mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
