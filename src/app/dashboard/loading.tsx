/**
 * Route-level loading state for every dashboard page.
 *
 * Until this file existed, the App Router had no Suspense boundary below the
 * layout — so clicking a sidebar link left the browser FROZEN on the old
 * page for however long the next page's server component spent querying
 * (hundreds of ms to seconds), with no cursor change, no spinner, nothing.
 * Users read that as "the app is slow" even when the server was reasonably
 * fast, because feedback, not latency, is what navigation feels like.
 *
 * With a loading.tsx, navigation paints this skeleton immediately and the
 * page streams in when ready. Deliberately generic — header bar, stat strip,
 * table rows — so it plausibly precedes any of the dashboard's screens
 * without needing a per-route variant.
 */

function Row() {
  return (
    <div className="flex items-center gap-3 border-t border-border px-3 py-3">
      <div className="h-3.5 w-3.5 animate-pulse rounded bg-surface-2" />
      <div className="h-3.5 flex-1 animate-pulse rounded bg-surface-2" />
      <div className="h-3.5 w-16 animate-pulse rounded bg-surface-2" />
      <div className="h-3.5 w-12 animate-pulse rounded bg-surface-2" />
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-6 w-44 animate-pulse rounded bg-surface-2" />
        <div className="h-3.5 w-72 animate-pulse rounded bg-surface-2" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border p-3">
            <div className="h-3 w-16 animate-pulse rounded bg-surface-2" />
            <div className="mt-2 h-5 w-24 animate-pulse rounded bg-surface-2" />
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border">
        <div className="px-3 py-3">
          <div className="h-4 w-32 animate-pulse rounded bg-surface-2" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <Row key={i} />
        ))}
      </div>
    </div>
  );
}
