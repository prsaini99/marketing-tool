"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyMetric } from "@/lib/display";

const ACCENT = "#2563eb";

interface SpendChartProps {
  metrics: DailyMetric[];
  currency?: string;
  rangeLabel?: string;
}

function makeTickFormatter(currency: string) {
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : "";
  return (v: number): string => {
    if (v >= 1000) return `${symbol}${(v / 1000).toFixed(v < 10000 ? 1 : 0)}k`;
    return `${symbol}${v}`;
  };
}

function makeTooltipFormatter(currency: string) {
  return (value: unknown) => {
    const n = Number(value);
    const f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
    return [f, "Spend"] as [string, string];
  };
}

export function SpendChart({
  metrics,
  currency = "USD",
  rangeLabel = "last 7 days",
}: SpendChartProps) {
  const formatTick = makeTickFormatter(currency);
  const tooltipFormatter = makeTooltipFormatter(currency);

  const data = metrics.map((m) => ({
    date: new Date(m.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    spend: m.spend,
  }));

  return (
    <div className="rounded-lg border border-border bg-background p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">
            Spend over time
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            Daily spend · {rangeLabel.toLowerCase()}
          </p>
        </div>
        {/* Metric toggle — mocked, only Spend is active in v1 */}
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5 text-xs">
          <button
            type="button"
            className="rounded-sm bg-surface-2 px-2 py-1 font-medium text-foreground"
          >
            Spend
          </button>
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-muted hover:text-foreground"
          >
            Impressions
          </button>
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-muted hover:text-foreground"
          >
            CTR
          </button>
        </div>
      </div>

      <div className="mt-5 h-60">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 5, right: 5, left: -10, bottom: 0 }}
          >
            <defs>
              <linearGradient id="spend-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACCENT} stopOpacity={0.18} />
                <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e4e4e7"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              stroke="#a1a1aa"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#a1a1aa"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatTick}
            />
            <Tooltip
              cursor={{ stroke: "#d4d4d8", strokeWidth: 1 }}
              contentStyle={{
                background: "white",
                border: "1px solid #e4e4e7",
                borderRadius: 6,
                fontSize: 12,
                padding: "6px 10px",
              }}
              formatter={tooltipFormatter}
              labelStyle={{ color: "#71717a", fontSize: 11 }}
            />
            <Area
              type="monotone"
              dataKey="spend"
              stroke={ACCENT}
              strokeWidth={2}
              fill="url(#spend-gradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
