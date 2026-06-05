/**
 * Playbook — the proactive view of what's working across the agency's
 * portfolio. Lists ad-copy "winners" (real spend / conversions /
 * meaningful CTR) ranked by the chosen metric, or semantically searchable
 * with the brand-voice + perf multiplier the AI Copy panel uses.
 *
 * Server component renders the breadcrumb + initial result (using URL
 * searchParams), then hands off to PlaybookBrowser for the interactive
 * filter / search UX. URL stays in sync so views are shareable.
 *
 * Phase-2 ideas (not built): bookmark a winner to a "saved" list,
 * cluster by hook type via LLM, copy-to-clipboard with brand-voice
 * adaptation already applied.
 */

import { headers } from "next/headers";
import { BookOpen } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import {
  PlaybookBrowser,
  type PlaybookEntry,
  type PlaybookStats,
} from "@/components/ai/playbook-browser";

export const dynamic = "force-dynamic";

type Metric = "roas" | "conversions" | "ctr" | "spend";

function parseMetric(v: string | undefined): Metric {
  if (v === "conversions" || v === "ctr" || v === "spend") return v;
  return "roas";
}

export default async function PlaybookPage({
  searchParams,
}: {
  searchParams: Promise<{
    client?: string;
    q?: string;
    metric?: string;
  }>;
}) {
  const sp = await searchParams;
  const client = sp.client?.trim() || null;
  const query = sp.q?.trim() || "";
  const metric = parseMetric(sp.metric);

  const selectedBusiness = client
    ? await prisma.metaBusiness.findUnique({
        where: { id: client },
        select: { id: true, name: true },
      })
    : null;

  // Empty state: no embeddings at all means the user hasn't synced
  // creatives yet (or auto-reindex hasn't completed). Bail early with
  // friendly copy rather than running an expensive search for nothing.
  const totalWinnersInScope = await prisma.embedding.count({
    where: {
      namespace: "ads",
      ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
    },
  });

  if (totalWinnersInScope === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Playbook</h1>
          <p className="mt-0.5 text-sm text-muted">
            What&apos;s working across your portfolio — performance-weighted,
            cross-account. Sync creatives on any account to populate this.
          </p>
        </div>
        <EmptyState
          icon={BookOpen}
          title="No indexed creatives yet"
          description="Click Sync now on any account's Ads page to index its creatives — winners will show up here once they have real spend or conversions."
          action={{
            label: "Go to Accounts",
            href: "/dashboard/accounts",
          }}
        />
      </div>
    );
  }

  // Fetch the initial entries server-side so the page lands rendered.
  // Re-uses the /api/ai/playbook endpoint to keep the data path single-
  // sourced — same shape we'll fetch on later filter changes.
  const hdrs = await headers();
  const host = hdrs.get("host") ?? "localhost:3000";
  const protocol = hdrs.get("x-forwarded-proto") ?? "http";
  const params = new URLSearchParams();
  if (client) params.set("client", client);
  if (query) params.set("q", query);
  params.set("metric", metric);

  let initialEntries: PlaybookEntry[] = [];
  let initialStats: PlaybookStats = {
    accountsRepresented: 0,
    avgRoas: 0,
  };
  try {
    const res = await fetch(
      `${protocol}://${host}/api/ai/playbook?${params.toString()}`,
      { cache: "no-store" },
    );
    if (res.ok) {
      const data = (await res.json()) as {
        entries: PlaybookEntry[];
        stats: PlaybookStats;
      };
      initialEntries = Array.isArray(data.entries) ? data.entries : [];
      initialStats = data.stats ?? initialStats;
    }
  } catch (err) {
    console.error("playbook page initial fetch failed:", err);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Playbook</h1>
        <p className="mt-0.5 text-sm text-muted">
          {selectedBusiness ? (
            <>
              Top-performing hooks and angles from{" "}
              <span className="text-foreground">{selectedBusiness.name}</span>
              &apos;s ad accounts.
            </>
          ) : (
            <>
              What&apos;s working across your portfolio —
              performance-weighted, cross-account.
            </>
          )}{" "}
          Filter by metric, or search for a specific hook.
        </p>
      </div>

      <PlaybookBrowser
        initialEntries={initialEntries}
        initialStats={initialStats}
        initialMetric={metric}
        initialQuery={query}
      />
    </div>
  );
}
