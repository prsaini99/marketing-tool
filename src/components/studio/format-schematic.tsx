"use client";

import type { AdFormat, BlockKind } from "@/server/services/ai/ad-formats";

/**
 * Renders a format's frame geometry as a schematic. Deliberately a diagram
 * and not a sample image: it is instant, costs nothing, and cannot mislead
 * about what the operator's own brand kit will actually produce.
 */

/**
 * Which of the kit's colours to use for each block, by index into the
 * palette. A schematic drawn in the client's actual colours reads as their
 * frame rather than a generic template.
 */
const PALETTE_SLOT: Record<BlockKind, number> = {
  headline: 0,
  body: 0,
  media: 1,
  cta: 1,
  accent: 1,
};

// Token names verified against src/app/globals.css.
const FILL: Record<BlockKind, string> = {
  headline: "var(--color-muted)",
  body: "var(--color-border-strong)",
  media: "var(--color-surface-2)",
  cta: "var(--color-accent)",
  accent: "var(--color-accent)",
};

export function FormatSchematic({
  format,
  /** Width ÷ height of the placement. 1 = square, 0.8 = 4:5, 0.5625 = 9:16. */
  ratio = 1,
  /** Appended to the caption, e.g. "Stories & Reels — 9:16". */
  frameLabel,
  /** The kit's palette, primary first. Drawn in place of the neutral fills. */
  palette = [],
}: {
  format: AdFormat;
  ratio?: number;
  frameLabel?: string;
  palette?: string[];
}) {
  function fillFor(kind: BlockKind): string {
    const colour = palette[PALETTE_SLOT[kind]] ?? palette[0];
    return colour ?? FILL[kind];
  }
  // Text blocks are drawn as stacked rules rather than solid slabs, so the
  // diagram reads as "type goes here" instead of "a grey box goes here".
  function isText(kind: BlockKind): boolean {
    return kind === "headline" || kind === "body";
  }
  // Blocks are authored in a 0-100 square. Scaling their vertical extent by
  // the placement's height keeps the composition's proportions while showing
  // the real frame shape — a Stories ad should not preview as a square.
  const height = 100 / ratio;
  const scale = height / 100;

  return (
    <figure className="m-0 space-y-3">
      <svg
        viewBox={`0 0 100 ${height.toFixed(2)}`}
        role="img"
        aria-label={`Layout diagram for ${format.name}${
          frameLabel ? `, ${frameLabel}` : ""
        }: ${format.anatomy}`}
        // max-h keeps a 9:16 diagram from dominating the canvas.
        className="max-h-[26rem] w-full max-w-md rounded-md border border-border bg-surface"
        preserveAspectRatio="xMidYMid meet"
      >
        {format.frame.map((b, i) => {
          const y = b.y * scale;
          const h = b.h * scale;
          const fill = fillFor(b.kind);
          if (!isText(b.kind)) {
            return (
              <g key={i}>
                <rect
                  x={b.x}
                  y={y}
                  width={b.w}
                  height={h}
                  rx={1.5}
                  fill={fill}
                  opacity={b.kind === "media" ? 0.22 : 0.9}
                  stroke={fill}
                  strokeWidth={b.kind === "media" ? 0.6 : 0}
                  strokeDasharray={b.kind === "media" ? "2 1.5" : undefined}
                />
                {b.label && h > 7 && (
                  <text
                    x={b.x + b.w / 2}
                    y={y + h / 2 + 1.4}
                    textAnchor="middle"
                    fontSize={3.4}
                    fill="var(--color-muted)"
                  >
                    {b.label}
                  </text>
                )}
              </g>
            );
          }
          // Two or three rules of decreasing width, suggesting set type.
          const rules = Math.max(1, Math.min(3, Math.round(h / 4)));
          const gap = h / rules;
          return (
            <g key={i}>
              {Array.from({ length: rules }, (_, r) => (
                <rect
                  key={r}
                  x={b.x}
                  y={y + r * gap}
                  width={b.w * (r === rules - 1 && rules > 1 ? 0.6 : 1)}
                  height={Math.min(gap * 0.55, b.kind === "headline" ? 4 : 2)}
                  rx={0.8}
                  fill={fill}
                  opacity={b.kind === "headline" ? 0.85 : 0.5}
                />
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption className="space-y-1 text-xs text-muted">
        <span className="block">
          {format.anatomy}
          {frameLabel && <span className="text-subtle"> · {frameLabel}</span>}
        </span>
        {/* Said plainly, because a wireframe invites exactly the wrong
            conclusion — that every generation comes back looking like this. */}
        <span className="block text-[11px] text-subtle">
          This is the frame, not the design. Photography, palette and
          treatment change every run.
        </span>
      </figcaption>
    </figure>
  );
}
