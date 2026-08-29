/**
 * Catches invented figures before they are drawn onto an image a client will
 * publish. The copy stage writes the strings that get rendered; a model asked
 * for an offer line will produce "FLAT 50% OFF" whether or not a discount
 * exists in its inputs, and a fabricated discount on a published ad is a
 * consumer-protection problem rather than a taste one.
 *
 * Follows the precedent in automation/ai-guards.ts: exact set membership over
 * figures extracted from the source material, deliberately NOT substring
 * matching — substring matching let unrelated adjacent numbers fuse into a
 * fabricated price.
 *
 * Imports nothing.
 */

/**
 * A four-digit number in 1900-2099 MIGHT be a year. It is also, in this
 * product's market, the shape of almost every price the copy stage could
 * invent: 1,999 / 1,499 / 2,999 is the Indian price band, and "1,999
 * reviews" is exactly the fabricated review count the design warns about.
 *
 * So the range alone exempts nothing. A figure is skipped only when a year
 * CUE sits next to it ("since 2019", "© 2024", "2019-2024"), and never when
 * a currency marker or a discount marker sits next to it — those two win
 * outright, because "₹2000" and "2000% off" are claims whatever the number
 * happens to be.
 */
const YEAR_RANGE = /^(19|20)\d{2}$/;

/** Immediately before the figure: "since 2019", "in 2019", "est. 2019", "© 2019", "from 2019". */
const YEAR_CUE_BEFORE = /(?:^|[^a-z])(?:since|in|est\.?|from|©)\s*$/i;
/** Immediately after the figure: a range like "2019-2024". */
const YEAR_CUE_AFTER = /^-\d{4}(?:$|[^0-9])/;
/** A currency marker immediately before the figure makes it a price, never a year. */
const CURRENCY_BEFORE = /(?:₹|\$|(?:^|[^a-z])(?:rs\.?|inr))\s*$/i;
/** A percent or discount marker immediately after makes it an offer, never a year. */
const OFFER_AFTER = /^\s*(?:%|off(?:$|[^a-z]))/i;

/**
 * True when this four-digit run reads as a year in context and should not be
 * treated as a claim. Everything else — including a bare "1999" with no cue —
 * is a figure that must be sourced.
 */
function isYearInContext(before: string, after: string, cleaned: string): boolean {
  if (!YEAR_RANGE.test(cleaned)) return false;
  if (CURRENCY_BEFORE.test(before)) return false;
  if (OFFER_AFTER.test(after)) return false;
  return YEAR_CUE_BEFORE.test(before) || YEAR_CUE_AFTER.test(after);
}

/**
 * Digit runs with optional comma grouping and one decimal part. A comma is
 * admitted only when a digit follows it immediately, so "10, 20" reads as two
 * figures rather than one fused "1020" — grouping inside a number never has a
 * space after the comma, and a comma-space is a list.
 */
const FIGURE = /\d+(?:,\d+)*(?:\.\d+)?/g;

/** Suffixes this product's users actually type. Order matters: check the
 *  longer words before the single letters they start with. */
const MAGNITUDE: Array<[RegExp, number]> = [
  [/^\s*(?:crores?|cr)\b/i, 10_000_000],
  [/^\s*(?:lakhs?|lacs?|l)\b/i, 100_000],
  [/^\s*k\b/i, 1_000],
];

/**
 * The same figures as extractFigures, but grouped: one array per match,
 * holding that figure's plain form and any magnitude expansion of it.
 *
 * findFabricated needs the grouping. A figure written "₹1.5L" in the copy is
 * sourced if the brief said either "1.5L" or "150000", so the test is whether
 * ANY of one figure's forms is allowed — flattening loses which forms belong
 * to which figure, and widening extraction instead would let an unrelated
 * source number vouch for a fabricated one.
 */
function extractFigureAliases(text: string): string[][] {
  const aliases: string[][] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(FIGURE)) {
    const raw = match[0];
    // Strip grouping separators only (commas, no spaces or periods).
    const cleaned = raw.replace(/,/g, "");
    if (!cleaned) continue;
    const before = text.slice(0, match.index!);
    const after = text.slice(match.index! + raw.length);
    if (isYearInContext(before, after, cleaned)) continue;
    const normalised = cleaned.includes(".")
      ? String(parseFloat(cleaned))
      : String(parseInt(cleaned, 10));
    if (normalised === "NaN") continue;

    const forms: string[] = [normalised];

    // Check for magnitude suffixes immediately following this match.
    for (const [pattern, multiplier] of MAGNITUDE) {
      const suffixMatch = after.match(pattern);
      if (suffixMatch) {
        const expanded = String(parseFloat(normalised) * multiplier);
        forms.push(expanded);
        break;
      }
    }

    // De-duplicate figures that have already been seen (handle overlapping matches).
    if (!seen.has(normalised)) {
      aliases.push(forms);
      seen.add(normalised);
    }
  }

  return aliases;
}

/**
 * Normalised figures found in the text: separators stripped, trailing
 * decimal zeroes dropped, so "₹1,000" and "1000" compare equal. When a
 * magnitude suffix (L, Cr, k, etc.) follows, emits both the plain value
 * and the expanded value.
 */
export function extractFigures(text: string): string[] {
  const out: string[] = [];
  for (const aliases of extractFigureAliases(text)) {
    for (const figure of aliases) {
      if (!out.includes(figure)) out.push(figure);
    }
  }
  return out;
}

/**
 * Figures present in the generated copy but absent from every source string.
 * An empty result means nothing was invented.
 */
export function findFabricated(copy: string[], sources: string[]): string[] {
  const allowed = new Set(sources.flatMap(extractFigures));
  const bad: string[] = [];
  for (const text of copy) {
    for (const aliases of extractFigureAliases(text)) {
      // Sourced if ANY form of this figure appears in the inputs.
      if (aliases.some((a) => allowed.has(a))) continue;
      const label = aliases[0];
      if (!bad.includes(label)) bad.push(label);
    }
  }
  return bad;
}
