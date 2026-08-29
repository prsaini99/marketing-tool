/**
 * Ad Studio — the standalone, discoverable entry point for the AI image
 * generator. Everything it needs already existed (buildStudioPrompt, the
 * brand-kit service/API, the generate route) but was reachable only by
 * drilling three levels into the New Ad modal. This route is that fix.
 *
 * Server shell: resolves the active client the same way the rest of the
 * dashboard does (`getActiveBusinessId` — `?client=` wins, and this route
 * isn't an entity drill-down so there's no path-derived fallback to worry
 * about) and loads that client's brand kit up front so the first paint
 * already reflects it. Everything interactive — the generation form,
 * results, the kit editor — lives in the client component.
 *
 * "All clients" (no `?client=`) is not an empty state — it is the
 * workspace's OWN brand kit, the operator's rather than any client's.
 * `getBrandKit(null)` addresses it. Nothing inherits in either direction:
 * a client with no kit gets an empty one, never the workspace's, because
 * each client owns their brand outright and will eventually edit it
 * behind their own login.
 */

import { getActiveBusinessId } from "@/lib/active-business";
import { getBrandKit } from "@/server/services/brand/kit";
import { prisma } from "@/lib/db/prisma";
import { StudioClient } from "@/components/studio/studio-client";

export const dynamic = "force-dynamic";

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const params = await searchParams;

  // /dashboard/studio is not an accounts/[id] drill-down, so the only
  // resolution path that can apply is the explicit `?client=` query param —
  // still routed through getActiveBusinessId (rather than reading
  // params.client directly) so this page stays consistent with however
  // that resolution logic evolves elsewhere in the dashboard.
  const businessId = getActiveBusinessId("/dashboard/studio", {
    get: (name: string) => (name === "client" ? (params.client ?? null) : null),
  });

  // businessId of null is a real scope, not "skip the lookup": it is the
  // workspace's own kit.
  const kit = await getBrandKit(businessId);

  // Ad accounts Save-to-library can upload into: the active client's
  // accounts when one is selected, otherwise every selectedForSync
  // account — mirrors /dashboard/accounts' own "All clients" behaviour.
  // Dedupe by metaAdAccountId for the same reason accounts/page.tsx does:
  // the same Meta account can come in via more than one Connection.
  const accountRows = await prisma.metaAdAccount.findMany({
    where: {
      selectedForSync: true,
      ...(businessId ? { businessId } : {}),
    },
    distinct: ["metaAdAccountId"],
    orderBy: { name: "asc" },
    select: { metaAdAccountId: true, name: true },
  });
  const adAccounts = accountRows.map((r) => ({
    id: r.metaAdAccountId,
    name: r.name,
  }));

  return (
    // Keyed on the active client so switching in the topbar (which updates
    // ?client= in place rather than remounting the route — /dashboard/studio
    // is in AccountSwitcher's FILTERABLE_ROUTES) fully remounts this subtree
    // instead of re-rendering it with new props. Without this, kit/palette/
    // themeNotes drafts are useState(initialX) initialisers that only run on
    // mount, so they'd keep showing (and, on Save, writing back) the
    // PREVIOUS client's brand kit while businessId silently moved on. A key
    // change also resets generation results/toggles/uploads, which is
    // correct: they describe the previous client's brief and cost real
    // OpenAI credits, so carrying them across a client switch would be
    // actively misleading, not a convenience lost.
    <StudioClient
      key={businessId ?? "all"}
      businessId={businessId}
      initialKit={kit}
      adAccounts={adAccounts}
    />
  );
}
