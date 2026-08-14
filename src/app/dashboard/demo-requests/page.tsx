/**
 * Inbound demo requests from the marketing site.
 *
 * The other end of /demo. Sits behind the session middleware like every
 * dashboard page; only the form that fills this table is public.
 */

import { Inbox } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DemoRequestsTable,
  type DemoRequestRow,
} from "@/components/marketing/demo-requests-table";

export const dynamic = "force-dynamic";

export default async function DemoRequestsPage() {
  const rows = await prisma.demoRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const items: DemoRequestRow[] = rows.map((r) => ({
    ...r,
    // Dates cross to a client component, so send them as strings rather than
    // relying on serialisation to do something sensible with a Date.
    createdAt: r.createdAt.toISOString(),
  }));

  const newCount = rows.filter((r) => r.status === "NEW").length;

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-10">
      <h1
        className="text-3xl font-bold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Demo requests
      </h1>
      <p className="mt-1.5 text-[15px] text-muted">
        {rows.length === 0
          ? "Everyone who asks for a demo on adsboys.com lands here."
          : `${rows.length} total, ${newCount} not yet contacted. Each one carries the page and campaign it came from.`}
      </p>

      <div className="mt-8">
        {rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No requests yet"
            description="Submissions from the demo form on the marketing site appear here, with the page and campaign that produced them."
          />
        ) : (
          <DemoRequestsTable rows={items} />
        )}
      </div>
    </div>
  );
}
