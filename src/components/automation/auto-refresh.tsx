"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a server-rendered page current without a manual reload.
 *
 * The inbox is a server component, so it only re-queries on navigation — a
 * DM that arrives by webhook sits invisible until the operator refreshes.
 * `router.refresh()` re-runs the server render and reconciles the result into
 * the existing tree, which is why this works without losing client state: the
 * compose box keeps whatever has been typed and an open confirm dialog stays
 * open. A full `location.reload()` would discard both.
 *
 * Polling rather than a socket is deliberate. The app runs on serverless
 * functions that cannot hold a long-lived connection, and Supabase Realtime is
 * unavailable here by design — every table has RLS enabled with zero policies,
 * which blocks the anon/Realtime path. Opening that up to stream one page's
 * updates would trade the app's tenancy boundary for a convenience.
 *
 * Hidden tabs are skipped, so a dashboard left open in a background tab
 * overnight costs nothing. Regaining focus refreshes immediately rather than
 * waiting out the interval, which is the case an operator actually notices —
 * switching back from Messenger and expecting the reply to be there.
 */
export function AutoRefresh({ intervalMs = 8000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    const timer = setInterval(refreshIfVisible, intervalMs);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [router, intervalMs]);

  return null;
}
