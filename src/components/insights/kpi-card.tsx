import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  change?: {
    value: string;
    direction: "up" | "down";
  };
}

/**
 * Hero metric card, per the dense-dashboard spec: letterspaced caps label,
 * a big display-face number (the thing the eye should land on), and the
 * delta as a tinted CHIP rather than bare colored text — chips survive
 * scanning at arm's length, bare text doesn't.
 *
 * Border-only, no shadow: elevation is reserved for true overlays.
 */
export function KpiCard({ label, value, change }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p
        className="mt-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </p>
      {change && (
        <span
          className={cn(
            "mt-2.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
            change.direction === "up"
              ? "bg-success-subtle text-success"
              : "bg-danger-subtle text-danger",
          )}
        >
          {change.direction === "up" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )}
          {change.value}
        </span>
      )}
    </div>
  );
}
