/**
 * The adsboys mark.
 *
 * A speech bubble containing three ascending bars. The product's whole
 * argument is that the ads and the conversations they start belong in one
 * place, so the mark fuses the two rather than picking one: performance
 * inside a message.
 *
 * Drawn as SVG rather than the stack of styled spans this replaces, for
 * three reasons. It can be a favicon. It stays crisp at any size instead of
 * relying on fractional CSS heights that round badly at 16px. And it can be
 * handed to anyone who needs the logo as a file.
 *
 * Built on a 32-unit grid with deliberately chunky geometry: the tail and
 * the gaps between bars are sized so the shape still reads as a bubble with
 * bars in a browser tab, which is where most logos quietly turn to mush.
 *
 * Colour comes from currentColor on the bubble and a paper token on the
 * bars, so one component works on the ink chrome, on paper, and inverted in
 * a dark tab strip without a second asset.
 */

export function BrandMark({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const px = size === "lg" ? 48 : size === "sm" ? 20 : 32;
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
      {/*
        Bubble. The tail is part of the same path rather than a separate
        shape, so it never separates from the body at small sizes or when the
        colour is inherited.
      */}
      <path
        d="M6 2h20a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H13l-6.2 5.4A1 1 0 0 1 5 28.6V24a4 4 0 0 1-3-3.9V6a4 4 0 0 1 4-4Z"
        fill="currentColor"
      />
      {/*
        Three ascending bars. Heights climb left to right so the shape reads
        as growth even when the bubble is the only thing a viewer registers.
        Rounded caps match the display typeface's soft terminals.
      */}
      <rect x="9" y="15" width="3.2" height="5" rx="1.6" fill="var(--color-background, #f6f5f1)" />
      <rect x="14.4" y="11" width="3.2" height="9" rx="1.6" fill="var(--color-background, #f6f5f1)" />
      <rect x="19.8" y="7" width="3.2" height="13" rx="1.6" fill="var(--color-background, #f6f5f1)" />
    </svg>
  );
}

/**
 * Mark plus wordmark, for headers and the footer.
 *
 * The name is lowercase everywhere on purpose: it is how the brand is
 * written in the product, the domain and the copy, and a capitalised
 * "Adsboys" in the logo would be the one place it disagreed with itself.
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
      <BrandMark size={size} className="text-accent" />
      <span
        className={`font-bold tracking-tight ${text}`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        adsboys
      </span>
    </span>
  );
}
