"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Clock, Info, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { SchedulesModal } from "@/components/schedules/schedules-modal";

interface AccountRowMenuProps {
  // Unprefixed metaAdAccountId — matches the URL form used throughout the app.
  accountIdUrl: string;
  // Display name shown in modal headers etc.
  accountName: string;
}

/**
 * The "more actions" affordance on each ad-account row.
 *
 * Row click still does the primary action (drill into campaigns). This menu
 * is for secondary actions — accumulates over time. Verbs go here; forms
 * open in modals; data views go to dedicated pages.
 *
 * stopPropagation everywhere so the menu and modal never bubble up to
 * trigger the row's onClick.
 */
export function AccountRowMenu({
  accountIdUrl,
  accountName,
}: AccountRowMenuProps) {
  const [open, setOpen] = useState(false);
  const [schedulesOpen, setSchedulesOpen] = useState(false);
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="More actions"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-md text-subtle transition-colors",
          "hover:bg-surface-2 hover:text-foreground",
          open && "bg-surface-2 text-foreground",
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-40 mt-1 w-56 overflow-hidden rounded-md border border-border bg-background shadow-md"
        >
          <ul className="py-1">
            <li>
              <Link
                href={`/dashboard/accounts/${accountIdUrl}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-surface-2"
              >
                <Info className="h-3.5 w-3.5 text-muted" />
                View account details
              </Link>
            </li>
            <li>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  setSchedulesOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-surface-2"
              >
                <Clock className="h-3.5 w-3.5 text-muted" />
                Auto-sync schedules
              </button>
            </li>
          </ul>
        </div>
      )}

      {schedulesOpen && (
        <SchedulesModal
          accountIdUrl={accountIdUrl}
          accountName={accountName}
          onClose={() => setSchedulesOpen(false)}
        />
      )}
    </div>
  );
}
