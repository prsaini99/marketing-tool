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

export function KpiCard({ label, value, change }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {change && (
        <p
          className={cn(
            "mt-2 inline-flex items-center gap-0.5 text-xs font-medium",
            change.direction === "up" ? "text-green-600" : "text-red-600",
          )}
        >
          {change.direction === "up" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )}
          {change.value}
        </p>
      )}
    </div>
  );
}
