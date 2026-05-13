import type { ReactNode } from "react";
import { prisma } from "@/lib/db/prisma";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
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

  return (
    <div className="flex min-h-screen">
      <Sidebar accountToBusiness={accountToBusiness} />
      <div className="flex flex-1 flex-col">
        <Topbar
          businesses={businesses}
          accountToBusiness={accountToBusiness}
        />
        <main className="flex-1 px-6 py-5">{children}</main>
      </div>
    </div>
  );
}
