"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronsUpDown, Globe, Plus } from "lucide-react";
import {
  getActiveBusinessId,
  type AccountBusinessMap,
} from "@/lib/active-business";

// Routes that support inline `?client=` filtering. On any of these, switching
// a client updates the current page's URL. On entity-specific drill-downs
// (e.g. /dashboard/accounts/[id]/campaigns) we fall back to /dashboard/accounts
// because the path-level ID belongs to a different client.
const FILTERABLE_ROUTES = new Set<string>([
  "/dashboard/accounts",
  "/dashboard/insights",
  "/dashboard/campaigns",
  "/dashboard/adsets",
  "/dashboard/ads",
  "/dashboard/audit-log",
  "/dashboard/setup-guide",
  "/dashboard/settings",
]);

interface AccountSwitcherProps {
  businesses: Array<{ id: string; name: string }>;
  accountToBusiness: AccountBusinessMap;
}

export function AccountSwitcher({
  businesses,
  accountToBusiness,
}: AccountSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = getActiveBusinessId(
    pathname,
    searchParams,
    accountToBusiness,
  );
  const selected = selectedId
    ? businesses.find((b) => b.id === selectedId)
    : null;

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function navigate(clientId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (clientId) {
      params.set("client", clientId);
    } else {
      params.delete("client");
    }

    const targetPath = FILTERABLE_ROUTES.has(pathname)
      ? pathname
      : "/dashboard/accounts";
    const qs = params.toString();
    router.push(`${targetPath}${qs ? `?${qs}` : ""}`);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm hover:bg-surface-2 transition-colors"
      >
        {selected ? (
          <>
            <div className="flex h-5 w-5 items-center justify-center rounded bg-surface-2 text-[11px] font-semibold text-muted">
              {selected.name[0]}
            </div>
            <span className="font-medium">{selected.name}</span>
          </>
        ) : (
          <>
            <Globe className="h-4 w-4 text-muted" />
            <span className="font-medium">All clients</span>
          </>
        )}
        <ChevronsUpDown className="h-3.5 w-3.5 text-subtle" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border border-border bg-background shadow-md">
          <ul>
            <li>
              <button
                type="button"
                onClick={() => navigate(null)}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-sm hover:bg-surface-2"
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded bg-surface-2">
                    <Globe className="h-3 w-3 text-muted" />
                  </div>
                  <span>All clients</span>
                </div>
                {!selectedId && <Check className="h-3.5 w-3.5 text-accent" />}
              </button>
            </li>
          </ul>
          {businesses.length > 0 && (
            <div className="border-t border-border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
              Clients
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto">
            {businesses.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => navigate(b.id)}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-sm hover:bg-surface-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-2 text-[11px] font-semibold text-muted">
                      {b.name[0]}
                    </div>
                    <span className="truncate" title={b.name}>
                      {b.name}
                    </span>
                  </div>
                  {/* Reserve check-mark width on every row so selecting an item
                      doesn't shrink the label and cause it to wrap. */}
                  <Check
                    className={`h-3.5 w-3.5 shrink-0 text-accent ${
                      selectedId === b.id ? "" : "invisible"
                    }`}
                  />
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/dashboard/connect-business");
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Connect a Meta business</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
