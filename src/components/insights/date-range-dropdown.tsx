"use client";

/**
 * Range picker: presets on the left, a two-click calendar on the right.
 *
 * Hand-rolled rather than pulling in a date library. The whole requirement
 * is one month grid with range selection, and a dependency for that would
 * outweigh the code it saves.
 *
 * All dates are handled in UTC, matching src/lib/date-range.ts and the
 * `date` column on InsightsSnapshot. Using local time here would put a user
 * in Asia/Kolkata half a day out from the rows they are selecting, and the
 * error would only appear near midnight, which is the worst way to find it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  CUSTOM_RANGE_VALUE,
  DEFAULT_RANGE_VALUE,
  isoDay,
  RANGE_PRESETS,
  resolveDateRange,
} from "@/lib/date-range";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** UTC midnight for a y/m/d. */
function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

/**
 * The 42 cells of a month grid, Monday first.
 *
 * Always six rows, so the popover does not change height as you page
 * through months. A panel that resizes under the cursor makes the next
 * click land somewhere unintended.
 */
function monthGrid(year: number, month: number): Date[] {
  const first = utc(year, month, 1);
  // getUTCDay is Sunday-first; shift so Monday is column 0.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = utc(year, month, 1 - lead);
  return Array.from({ length: 42 }, (_, i) =>
    utc(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i),
  );
}

export function DateRangeDropdown() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rangeParam = searchParams.get("range");
  const resolved = resolveDateRange(
    rangeParam,
    searchParams.get("from"),
    searchParams.get("to"),
  );

  const [open, setOpen] = useState(false);
  const [showCalendar, setShowCalendar] = useState(
    resolved.value === CUSTOM_RANGE_VALUE,
  );
  const [anchor, setAnchor] = useState(() => {
    const base = resolved.from ? new Date(`${resolved.from}T00:00:00Z`) : new Date();
    return { year: base.getUTCFullYear(), month: base.getUTCMonth() };
  });
  // Selection in progress. `end` is null between the first and second click.
  const [sel, setSel] = useState<{ start: string; end: string | null } | null>(
    resolved.from ? { start: resolved.from, end: resolved.to ?? null } : null,
  );
  const [hover, setHover] = useState<string | null>(null);

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const today = useMemo(() => isoDay(new Date()), []);
  const grid = useMemo(() => monthGrid(anchor.year, anchor.month), [anchor]);

  function push(params: URLSearchParams) {
    const qs = params.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`);
    setOpen(false);
  }

  function choosePreset(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("from");
    params.delete("to");
    if (value === DEFAULT_RANGE_VALUE) params.delete("range");
    else params.set("range", value);
    push(params);
  }

  function applyCustom(from: string, to: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", CUSTOM_RANGE_VALUE);
    params.set("from", from);
    params.set("to", to);
    push(params);
  }

  function onDayClick(day: string) {
    if (day > today) return;
    if (!sel || sel.end !== null) {
      setSel({ start: day, end: null });
      return;
    }
    // Second click completes the range. Reversed order is a slip, not an
    // error, so normalise instead of rejecting.
    const [from, to] = day < sel.start ? [day, sel.start] : [sel.start, day];
    setSel({ start: from, end: to });
    applyCustom(from, to);
  }

  // The band to highlight, including the live preview while the second click
  // is still pending.
  const band = (() => {
    if (!sel) return null;
    const end = sel.end ?? hover;
    if (!end) return { from: sel.start, to: sel.start };
    return end < sel.start
      ? { from: end, to: sel.start }
      : { from: sel.start, to: end };
  })();

  function shiftMonth(delta: number) {
    setAnchor((a) => {
      const d = utc(a.year, a.month + delta, 1);
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-surface-2"
      >
        <Calendar className="h-3.5 w-3.5 text-muted" />
        {resolved.label}
        <ChevronDown className="h-3.5 w-3.5 text-subtle" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 flex overflow-hidden rounded-xl border border-border bg-background shadow-modal">
          <ul className="w-40 shrink-0 border-r border-border py-1">
            {RANGE_PRESETS.map((p) => (
              <li key={p.value}>
                <button
                  type="button"
                  onClick={() => choosePreset(p.value)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-surface-2"
                >
                  <span>{p.label}</span>
                  {p.value === resolved.value && (
                    <Check className="h-3.5 w-3.5 text-accent" />
                  )}
                </button>
              </li>
            ))}
            <li className="my-1 border-t border-border" />
            <li>
              <button
                type="button"
                onClick={() => setShowCalendar((v) => !v)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-surface-2"
              >
                <span>Custom range</span>
                {resolved.value === CUSTOM_RANGE_VALUE ? (
                  <Check className="h-3.5 w-3.5 text-accent" />
                ) : (
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 text-subtle transition-transform",
                      showCalendar && "rotate-90",
                    )}
                  />
                )}
              </button>
            </li>
          </ul>

          {showCalendar && (
            <div className="w-[17.5rem] p-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  aria-label="Previous month"
                  className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold">
                  {MONTHS[anchor.month]} {anchor.year}
                </span>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  aria-label="Next month"
                  className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-2 grid grid-cols-7 gap-y-0.5">
                {WEEKDAYS.map((w) => (
                  <div
                    key={w}
                    className="pb-1 text-center text-[11px] font-semibold uppercase text-subtle"
                  >
                    {w}
                  </div>
                ))}
                {grid.map((d) => {
                  const day = isoDay(d);
                  const inMonth = d.getUTCMonth() === anchor.month;
                  const future = day > today;
                  const isStart = band && day === band.from;
                  const isEnd = band && day === band.to;
                  const inBand = band && day >= band.from && day <= band.to;
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={future}
                      onClick={() => onDayClick(day)}
                      onMouseEnter={() => setHover(day)}
                      onMouseLeave={() => setHover(null)}
                      className={cn(
                        "h-8 text-[13px] tabular-nums transition-colors",
                        // Square the inner days so a selected band reads as
                        // one continuous bar, rounded only at its ends.
                        inBand && !isStart && !isEnd && "bg-accent-subtle",
                        isStart && isEnd && "rounded-md bg-accent text-accent-foreground",
                        isStart && !isEnd && "rounded-l-md bg-accent text-accent-foreground",
                        isEnd && !isStart && "rounded-r-md bg-accent text-accent-foreground",
                        !inBand && "rounded-md hover:bg-surface-2",
                        !inMonth && !inBand && "text-subtle",
                        future && "cursor-not-allowed text-subtle opacity-40 hover:bg-transparent",
                      )}
                    >
                      {d.getUTCDate()}
                    </button>
                  );
                })}
              </div>

              <p className="mt-2 border-t border-border pt-2 text-[12px] text-subtle">
                {sel && sel.end === null
                  ? "Now pick the end date."
                  : "Pick a start date, then an end date."}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
