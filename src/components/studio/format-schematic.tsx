"use client";

import type { AdFormat, BlockKind } from "@/server/services/ai/ad-formats";

/**
 * Renders a format's frame geometry as a schematic. Deliberately a diagram
 * and not a sample image: it is instant, costs nothing, and cannot mislead
 * about what the operator's own brand kit will actually produce.
 */

// Token names verified against src/app/globals.css.
const FILL: Record<BlockKind, string> = {
  headline: "var(--color-muted)",
  body: "var(--color-border-strong)",
  media: "var(--color-surface-2)",
  cta: "var(--color-accent)",
  accent: "var(--color-accent)",
};

export function FormatSchematic({ format }: { format: AdFormat }) {
  return (
    <figure className="m-0 space-y-3">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={`Layout diagram for ${format.name}: ${format.anatomy}`}
        className="w-full max-w-md rounded-md border border-border bg-surface"
      >
        {format.frame.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={1.5}
            fill={FILL[b.kind]}
            opacity={b.kind === "media" ? 1 : 0.75}
          />
        ))}
      </svg>
      <figcaption className="text-xs text-muted">{format.anatomy}</figcaption>
    </figure>
  );
}
