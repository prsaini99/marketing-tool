"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle, BarChart3, BookOpen, BookMarked, Building2, FileClock, FileText, Image as ImageIcon, Images, Layers, Megaphone, MessageSquare, Settings, Sparkles, Target, Users, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getActiveBusinessId,
  type AccountBusinessMap,
} from "@/lib/active-business";

const navItems = [
  { href: "/dashboard/accounts", label: "Accounts", icon: Building2 },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/dashboard/adsets", label: "Ad sets", icon: Layers },
  { href: "/dashboard/ads", label: "Ads", icon: ImageIcon },
  { href: "/dashboard/creatives", label: "Creatives", icon: Sparkles },
  { href: "/dashboard/images", label: "Image library", icon: Images },
  { href: "/dashboard/videos", label: "Video library", icon: Video },
  { href: "/dashboard/audiences", label: "Audiences", icon: Users },
  { href: "/dashboard/conversions", label: "Conversions", icon: Target },
  { href: "/dashboard/insights", label: "Insights", icon: BarChart3 },
  { href: "/dashboard/reports", label: "Reports", icon: FileText },
  { href: "/dashboard/alerts", label: "Alerts", icon: AlertTriangle, badgeKey: "alertCount" as const },
  { href: "/dashboard/chat", label: "AI Assistant", icon: MessageSquare },
  { href: "/dashboard/playbook", label: "Playbook", icon: BookMarked },
  { href: "/dashboard/audit-log", label: "Audit log", icon: FileClock },
  { href: "/dashboard/setup-guide", label: "Setup guide", icon: BookOpen },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  accountToBusiness: AccountBusinessMap;
  /** Undismissed-alerts count — drives the badge on the Alerts entry. */
  alertCount?: number;
}

export function Sidebar({ accountToBusiness, alertCount = 0 }: SidebarProps) {
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
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-foreground text-sm font-semibold">
          M
        </div>
        <span className="text-sm font-semibold tracking-tight">Meta Tool</span>
      </div>

      <nav className="flex-1 px-2 py-3">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            const badge =
              "badgeKey" in item && item.badgeKey === "alertCount"
                ? alertCount
                : 0;
            return (
              <li key={item.href}>
                <Link
                  href={`${item.href}${querySuffix}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-surface-2 text-foreground font-medium"
                      : "text-muted hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {badge > 0 && (
                    <span
                      className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
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
      </nav>

      <div className="border-t border-border px-3 py-2">
        <span className="text-xs text-subtle">Phase 0 — Setup</span>
      </div>
    </aside>
  );
}
