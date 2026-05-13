type ParamReader = { get(name: string): string | null };

/**
 * Maps `act_…` metaAdAccountId → owning business id.
 * Sourced server-side from the dashboard layout and passed down to client
 * components that need it (sidebar, account-switcher).
 */
export type AccountBusinessMap = Record<string, string>;

/**
 * Returns the currently-active business id from either the explicit `?client=`
 * query param OR derived from the URL path (when on an entity-specific
 * drill-down like /dashboard/accounts/[id]/campaigns). Query param wins.
 *
 * Without this, drilling into one of a client's ad accounts would silently
 * clear the active-client indicator, even though the path itself uniquely
 * identifies which client owns the entity being viewed.
 */
export function getActiveBusinessId(
  pathname: string,
  searchParams: ParamReader,
  accountToBusiness?: AccountBusinessMap,
): string | null {
  const fromQuery = searchParams.get("client");
  if (fromQuery) return fromQuery;

  const match = pathname.match(/^\/dashboard\/accounts\/([^/]+)/);
  if (match && accountToBusiness) {
    const accountId = `act_${match[1]}`;
    return accountToBusiness[accountId] ?? null;
  }
  return null;
}
