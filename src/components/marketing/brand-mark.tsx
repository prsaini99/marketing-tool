/**
 * The adsboys mark: a lowercase "a" drawn as one heavy monoline, its stem
 * rising past the x-height into an upward tail, with a solid ember dot as
 * the counter.
 *
 * Chosen over feature imagery on purpose. Bars, arrows and speech bubbles
 * all pin the identity to one capability, and the messaging half of the
 * product is subject to Meta's approval; a monogram is true regardless of
 * which features a given deployment has enabled. The rising tail carries
 * the growth connotation without being a chart, and the dot carries the
 * accent colour without the mark depending on it.
 *
 * Hand-traced from the approved generation rather than shipped as a PNG:
 * the raster sat on a painted background and could not be a favicon, could
 * not inherit the chrome's text colour, and could not be handed to anyone
 * as a file. This is the same geometry as app/icon.svg; change one, change
 * both.
 *
 * The letter strokes use currentColor so the mark is ink on paper, paper on
 * ink, or anything else the parent sets, with no second asset. Only the dot
 * is opinionated.
 */

export function BrandMark({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const px = size === "lg" ? 48 : size === "sm" ? 22 : 32;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="adsboys"
      className={className}
    >
      {/* Bowl. A full geometric circle, Futura-style single-storey "a";
          the stem below runs tangent to its right edge so the two strokes
          merge into one letterform rather than reading as ring-plus-line. */}
      <circle
        cx="13"
        cy="19"
        r="8"
        stroke="currentColor"
        strokeWidth="5"
        fill="none"
      />
      {/* Stem, continuing above the x-height and sweeping up-right. The
          sweep is what makes it adsboys rather than a typeface sample. */}
      <path
        d="M27 5.5C23.2 7.3 21 10.2 21 14V26.5"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Counter. The one fixed-colour element in the mark. */}
      <circle cx="13" cy="19" r="3.2" fill="var(--color-accent, #e8590c)" />
    </svg>
  );
}

/**
 * Mark plus wordmark, for headers and the footer. Lowercase everywhere:
 * it is how the name is written in the product, the domain and the copy,
 * and the logo should not be the one place that disagrees.
 */
export function BrandLockup({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const text =
    size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-lg";
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandMark size={size} />
      <span
        className={`font-bold tracking-tight ${text}`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        adsboys
      </span>
    </span>
  );
}
