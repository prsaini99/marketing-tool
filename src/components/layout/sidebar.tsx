"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle, BarChart3, BookOpen, BookMarked, Bot, Building2, FileClock, FileText, Inbox, Megaphone, MessageSquare, Settings, Sparkles, Users, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/marketing/brand-mark";
import {
  getActiveBusinessId,
  type AccountBusinessMap,
} from "@/lib/active-business";
import { isReviewerAllowedPath, type SessionRole } from "@/lib/auth";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Building2;
  badgeKey?: "alertCount" | "needsAttentionCount" | "demoRequestCount";
  /**
   * Extra path prefixes this entry stays highlighted for. A cluster entry
   * (e.g. Campaigns) represents its whole tab strip, so /dashboard/adsets
   * must light the Campaigns row even though the hrefs are unrelated.
   */
  also?: string[];
}

interface NavSection {
  /** null = no heading (the top, always-visible cluster). */
  title: string | null;
  items: NavItem[];
}

/**
 * Grouped by the QUESTION the user arrives with, ordered by how often each
 * question comes up — not by the Meta object model, which is what the old
 * 19-item flat list amounted to and what made it read as a wall.
 *
 *   (top)        "How is everything doing?"  → Accounts, Insights, Alerts
 *   Manage       "Change what's running"     → the campaign hierarchy
 *   Library      "Reusable pieces"           → creatives/media/audiences
 *   AI           "Analyse and generate"      → assistant, playbook, reports
 *   Messaging    "Talk to customers"         → the bot + its inbox together
 *   Admin        "Configure the tool"        → rarely-visited, bottom
 *
 * Inbox sits directly under Automation on purpose — they are two views of
 * the same feature and used to be nine rows apart.
 */
const navSections: NavSection[] = [
  {
    title: null,
    items: [
      { href: "/dashboard/accounts", label: "Accounts", icon: Building2 },
      { href: "/dashboard/insights", label: "Insights", icon: BarChart3 },
      { href: "/dashboard/alerts", label: "Alerts", icon: AlertTriangle, badgeKey: "alertCount" },
    ],
  },
  {
    title: "Advertise",
    items: [
      {
        href: "/dashboard/campaigns",
        label: "Campaigns",
        icon: Megaphone,
        also: ["/dashboard/adsets", "/dashboard/ads"],
      },
      {
        href: "/dashboard/creatives",
        label: "Creative library",
        icon: Sparkles,
        also: ["/dashboard/images", "/dashboard/videos"],
      },
      {
        href: "/dashboard/audiences",
        label: "Audiences",
        icon: Users,
        also: ["/dashboard/conversions"],
      },
    ],
  },
  {
    title: "AI",
    items: [
      { href: "/dashboard/copilot", label: "Campaign copilot", icon: Wand2 },
      { href: "/dashboard/chat", label: "Assistant", icon: MessageSquare },
      { href: "/dashboard/playbook", label: "Playbook", icon: BookMarked },
      { href: "/dashboard/reports", label: "Reports", icon: FileText },
    ],
  },
  {
    title: "Messaging",
    items: [
      { href: "/dashboard/automation", label: "Automation", icon: Bot, badgeKey: "needsAttentionCount" },
      { href: "/dashboard/automation/inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/dashboard/demo-requests", label: "Demo requests", icon: Inbox, badgeKey: "demoRequestCount" },
      { href: "/dashboard/audit-log", label: "Audit log", icon: FileClock },
      { href: "/dashboard/setup-guide", label: "Setup guide", icon: BookOpen },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
];

interface SidebarProps {
  accountToBusiness: AccountBusinessMap;
  /** Undismissed-alerts count — drives the badge on the Alerts entry. */
  alertCount?: number;
  /**
   * Threads across all accounts with flagReason != null AND resolvedAt ==
   * null — drives the "needs attention" badge on the Automation entry.
   */
  needsAttentionCount?: number;
  /** Demo requests still marked NEW, so a lead cannot sit unnoticed. */
  demoRequestCount?: number;
  /**
   * Session role from the server component that renders this (dashboard
   * layout reads the cookie via getSessionRole and passes it down — this
   * stays a client component for the pathname/search-param logic below, so
   * the role can't be looked up here directly). A reviewer session can only
   * reach automation/inbox routes (enforced again, independently, in
   * middleware), so entries it would just bounce off of are hidden rather
   * than left to 403/redirect on click. Undefined/"owner" shows everything.
   */
  role?: SessionRole;
}

export function Sidebar({
  accountToBusiness,
  alertCount = 0,
  needsAttentionCount = 0,
  demoRequestCount = 0,
  role,
}: SidebarProps) {
  // Reviewer sessions see only the sections/items they can reach; empty
  // sections disappear entirely rather than leaving orphaned headings.
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items:
        role === "reviewer"
          ? section.items.filter((item) => isReviewerAllowedPath(item.href))
          : section.items,
    }))
    .filter((section) => section.items.length > 0);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Preserve every active search param across sidebar nav (range, client, etc.).
  // For client specifically: if the current URL is a drill-down path with no
  // `?client=` in the query, derive it from the path so navigating away keeps
  // the active client visible.
  const params = new URLSearchParams(searchParams.toString());
  const derivedClient = getActiveBusinessId(
    pathname,
    searchParams,
    accountToBusiness,
  );
  if (derivedClient && !params.has("client")) {
    params.set("client", derivedClient);
  }
  const qs = params.toString();
  const querySuffix = qs ? `?${qs}` : "";

  return (
    // sticky + h-screen pins the rail to the viewport while the main column
    // scrolls. h-screen (not min-h-screen) is what bounds the nav below so it
    // can scroll internally instead of pushing the footer off-screen.
    <aside className="chrome-rail sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-ink-border text-ink-foreground">
      <div className="flex h-14 items-center gap-2.5 border-b border-ink-border px-4">
        {/* One mark everywhere: the same "a" the marketing site and the
            favicon carry, inheriting the chrome's ink-foreground. */}
        <BrandMark size="sm" />
        <span
          className="text-[15px] font-bold tracking-tight text-ink-foreground"
          style={{ fontFamily: "var(--font-display)" }}
        >
          adsboys
        </span>
      </div>

      {/* min-h-0 is required: a flex child defaults to min-height:auto, which
          refuses to shrink below its content and would let 17 nav items push
          past the viewport instead of scrolling here. */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {visibleSections.map((section, i) => (
          <div key={section.title ?? "top"} className={i > 0 ? "mt-4" : undefined}>
            {section.title && (
              <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                {section.title}
              </div>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                // Prefix-matching alone breaks sibling routes that nest:
                // /dashboard/automation/inbox starts with /dashboard/automation,
                // so both rows would light up on the inbox. An item is active
                // on an exact match, or on a sub-path that no OTHER item
                // claims more specifically.
                const claimedByMoreSpecific = section.items.some(
                  (other) =>
                    other !== item &&
                    other.href.startsWith(item.href + "/") &&
                    (pathname === other.href ||
                      pathname.startsWith(other.href + "/")),
                );
                const matchesAlso = (item.also ?? []).some(
                  (a) => pathname === a || pathname.startsWith(a + "/"),
                );
                const isActive =
                  pathname === item.href ||
                  matchesAlso ||
                  (pathname.startsWith(item.href + "/") && !claimedByMoreSpecific);
                const Icon = item.icon;
                const badge =
                  item.badgeKey === "alertCount"
                    ? alertCount
                    : item.badgeKey === "needsAttentionCount"
                      ? needsAttentionCount
                      : item.badgeKey === "demoRequestCount"
                        ? demoRequestCount
                        : 0;
                // Alerts stays red (danger); "needs attention" signals a
                // thread waiting on a human, not an outright failure, so it
                // gets the amber warning treatment.
                const badgeClass =
                  item.badgeKey === "needsAttentionCount"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-danger text-white";
                return (
                  <li key={item.href}>
                    <Link
                      href={`${item.href}${querySuffix}`}
                      className={cn(
                        "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-150",
                        isActive
                          ? "bg-glow/10 font-medium text-ink-foreground"
                          : "text-ink-muted hover:bg-white/5 hover:text-ink-foreground",
                      )}
                    >
                      {isActive && (
                        <span className="absolute -left-2 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-glow" />
                      )}
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors",
                          isActive ? "text-glow" : "text-ink-subtle group-hover:text-ink-muted",
                        )}
                      />
                      <span className="flex-1">{item.label}</span>
                      {badge > 0 && (
                        <span
                          className={cn(
                            "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                            badgeClass,
                          )}
                          aria-label={`${badge} unread`}
                        >
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

    </aside>
  );
}
