"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Browser-back, surfaced in the UI.
 *
 * Lives in the topbar rather than on each page: the drill-down hierarchy
 * (account → campaign → ad set → ad) is four levels deep and breadcrumbs
 * only exist on some of them, so "how do I get back?" currently means
 * finding the browser chrome. One persistent control answers it everywhere.
 *
 * It hides on the top-level section roots — Accounts, Campaigns, Alerts and
 * friends — because "back" from a place the sidebar took you is meaningless
 * or worse (it can bounce through login redirects). Everywhere deeper, it
 * shows. router.back() is used rather than a computed parent URL so query
 * state (client, range, filters) survives, exactly as the browser button
 * would preserve it.
 */

const SECTION_ROOTS = new Set([
  "/dashboard",
  "/dashboard/accounts",
  "/dashboard/campaigns",
  "/dashboard/adsets",
  "/dashboard/ads",
  "/dashboard/creatives",
  "/dashboard/images",
  "/dashboard/videos",
  "/dashboard/audiences",
  "/dashboard/conversions",
  "/dashboard/insights",
  "/dashboard/reports",
  "/dashboard/alerts",
  "/dashboard/chat",
  "/dashboard/playbook",
  "/dashboard/automation",
  "/dashboard/audit-log",
  "/dashboard/setup-guide",
  "/dashboard/settings",
  "/dashboard/connect-business",
]);

export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();

  if (SECTION_ROOTS.has(pathname)) return null;

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-foreground"
      aria-label="Go back"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back
    </button>
  );
}
