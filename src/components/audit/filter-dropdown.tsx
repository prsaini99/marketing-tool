"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Filter, Tag, type LucideIcon } from "lucide-react";

interface Option {
  value: string;
  label: string;
}

// Resolves an icon string to its lucide component inside this client file.
// Done this way because lucide icon components are functions, and Next.js
// can't serialize functions from a Server Component to a Client Component
// — we can only pass strings/POJOs across that boundary.
const ICONS: Record<string, LucideIcon> = {
  tag: Tag,
  filter: Filter,
};

interface FilterDropdownProps {
  // The query-string key this dropdown writes to (e.g. "target", "action").
  paramKey: string;
  // Value used when "all" / unset.
  defaultValue: string;
  options: Option[];
  iconName: keyof typeof ICONS;
  // Resets ?page= back to 1 whenever the filter changes — otherwise the user
  // can land on page 7 of a filter set that has 2 pages.
  resetPageOnChange?: boolean;
}

export function FilterDropdown({
  paramKey,
  defaultValue,
  options,
  iconName,
  resetPageOnChange = true,
}: FilterDropdownProps) {
  const Icon = ICONS[iconName];
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(paramKey) ?? defaultValue;
  const selected = options.find((o) => o.value === current) ?? options[0];
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

  function navigate(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) params.delete(paramKey);
    else params.set(paramKey, value);
    if (resetPageOnChange) params.delete("page");
    const qs = params.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium hover:bg-surface-2 transition-colors"
      >
        <Icon className="h-3.5 w-3.5 text-muted" />
        {selected.label}
        <ChevronDown className="h-3.5 w-3.5 text-subtle" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-md border border-border bg-background shadow-md">
          <ul>
            {options.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => navigate(o.value)}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-sm hover:bg-surface-2"
                >
                  <span>{o.label}</span>
                  {o.value === current && (
                    <Check className="h-3.5 w-3.5 text-accent" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
