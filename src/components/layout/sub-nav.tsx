"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Tab strip for sibling pages that form one workspace — Campaigns/Ad sets/
 * Ads, or the creative library trio.
 *
 * This is the other half of the sidebar diet: instead of every page owning a
 * sidebar row (19 rows, wall-of-links), each CLUSTER owns one row and the
 * pages inside it become tabs. The user's mental model gets two clean
 * levels — "which area?" (sidebar) then "which view?" (tabs) — rather than
 * one flat namespace where Ad sets and Audit log carry equal visual weight.
 *
 * Query params are preserved across tab switches for the same reason the
 * sidebar preserves them: ?client= and ?range= describe what the user is
 * looking at, not where, and switching view must not reset them.
 */

export interface SubNavItem {
  href: string;
  label: string;
}

export function SubNav({ items }: { items: SubNavItem[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const suffix = qs ? `?${qs}` : "";

  return (
    <div className="flex gap-1 border-b border-border pb-2">
      {items.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={`${item.href}${suffix}`}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:bg-surface-2 hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

/** The three workspaces that use tab strips, defined once. */
export const MANAGE_TABS: SubNavItem[] = [
  { href: "/dashboard/campaigns", label: "Campaigns" },
  { href: "/dashboard/adsets", label: "Ad sets" },
  { href: "/dashboard/ads", label: "Ads" },
];

export const LIBRARY_TABS: SubNavItem[] = [
  { href: "/dashboard/creatives", label: "Creatives" },
  { href: "/dashboard/images", label: "Images" },
  { href: "/dashboard/videos", label: "Videos" },
];

export const TARGETING_TABS: SubNavItem[] = [
  { href: "/dashboard/audiences", label: "Audiences" },
  { href: "/dashboard/conversions", label: "Conversions" },
];
