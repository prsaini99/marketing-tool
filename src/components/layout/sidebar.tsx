"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BarChart3, Building2, Megaphone, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getActiveBusinessId,
  type AccountBusinessMap,
} from "@/lib/active-business";

const navItems = [
  { href: "/dashboard/accounts", label: "Accounts", icon: Building2 },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/dashboard/insights", label: "Insights", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  accountToBusiness: AccountBusinessMap;
}

export function Sidebar({ accountToBusiness }: SidebarProps) {
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
                  <span>{item.label}</span>
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
