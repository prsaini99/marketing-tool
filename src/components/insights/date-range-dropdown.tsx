"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Calendar, Check, ChevronDown } from "lucide-react";
import {
  DEFAULT_RANGE_VALUE,
  RANGE_PRESETS,
} from "@/lib/date-range";

export function DateRangeDropdown() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("range") ?? DEFAULT_RANGE_VALUE;
  const selected =
    RANGE_PRESETS.find((p) => p.value === current) ?? RANGE_PRESETS[0];
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
    if (value === DEFAULT_RANGE_VALUE) params.delete("range");
    else params.set("range", value);
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
        <Calendar className="h-3.5 w-3.5 text-muted" />
        {selected.label}
        <ChevronDown className="h-3.5 w-3.5 text-subtle" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-md border border-border bg-background shadow-md">
          <ul>
            {RANGE_PRESETS.map((p) => (
              <li key={p.value}>
                <button
                  type="button"
                  onClick={() => navigate(p.value)}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-sm hover:bg-surface-2"
                >
                  <span>{p.label}</span>
                  {p.value === current && (
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
