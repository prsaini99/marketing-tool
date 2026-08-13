/**
 * Date range presets and custom ranges, surfaced via `?range=` (plus
 * `?from=` and `?to=` when the range is custom).
 *
 * Single source of truth for the dropdown UI and every server-side query.
 * Add a preset here and both update in lockstep.
 *
 * BOUNDS. `since` is the inclusive UTC start-of-day; `until` is the
 * inclusive UTC end-of-day. Both may be null, meaning unbounded on that
 * side. The upper bound exists because custom ranges can end in the past:
 * before custom ranges, every query was "from X until now" and an upper
 * bound was never needed, which is exactly why it was missing when it
 * suddenly was.
 *
 * Everything here is pure so it can be tested without a database or a
 * browser. `now` is injectable for the same reason.
 */

export const DEFAULT_RANGE_VALUE = "7d";
export const CUSTOM_RANGE_VALUE = "custom";

const PRESET_DAYS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: 0, // 0 = unbounded
};

const PRESET_LABELS: Record<string, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

export const RANGE_PRESETS = (Object.keys(PRESET_DAYS) as readonly string[]).map(
  (value) => ({
    value,
    label: PRESET_LABELS[value],
    days: PRESET_DAYS[value],
  }),
);

export interface ResolvedDateRange {
  value: string;
  label: string;
  /** Inclusive UTC start-of-day, or null for unbounded. */
  since: Date | null;
  /** Inclusive UTC end-of-day, or null for unbounded. */
  until: Date | null;
  /** Present only for a custom range, as yyyy-mm-dd. */
  from?: string;
  to?: string;
}

/** yyyy-mm-dd in UTC. The wire format for custom ranges. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a yyyy-mm-dd into a UTC instant, or null when it is not a real date.
 *
 * Checked by round-tripping rather than by Date.parse alone, because
 * Date.parse("2026-02-31") happily rolls over into March and would silently
 * widen a range the user never asked for.
 */
function parseDay(raw: string | null | undefined, endOfDay: boolean): Date | null {
  if (!raw || !ISO_DAY.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (isoDay(d) !== raw) return null;
  if (endOfDay) d.setUTCHours(23, 59, 59, 999);
  return d;
}

function formatDay(raw: string): string {
  const d = new Date(`${raw}T00:00:00.000Z`);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function resolveDateRange(
  raw: string | null | undefined,
  from?: string | null,
  to?: string | null,
  now: Date = new Date(),
): ResolvedDateRange {
  if (raw === CUSTOM_RANGE_VALUE) {
    let since = parseDay(from, false);
    let until = parseDay(to, true);

    // A custom range with neither bound is meaningless; fall back rather
    // than silently returning every row ever, which is the one outcome a
    // person picking specific dates definitely did not want.
    if (!since && !until) return resolveDateRange(DEFAULT_RANGE_VALUE, null, null, now);

    // Reversed input is a slip, not an error. Swap it.
    if (since && until && since > until) {
      const s = isoDay(since);
      const u = isoDay(until);
      since = parseDay(u, false);
      until = parseDay(s, true);
    }

    const fromStr = since ? isoDay(since) : undefined;
    const toStr = until ? isoDay(until) : undefined;
    const label =
      fromStr && toStr
        ? fromStr === toStr
          ? formatDay(fromStr)
          : `${formatDay(fromStr)} to ${formatDay(toStr)}`
        : fromStr
          ? `From ${formatDay(fromStr)}`
          : `Until ${formatDay(toStr!)}`;

    return {
      value: CUSTOM_RANGE_VALUE,
      label,
      since,
      until,
      from: fromStr,
      to: toStr,
    };
  }

  const value = raw && PRESET_DAYS[raw] !== undefined ? raw : DEFAULT_RANGE_VALUE;
  const days = PRESET_DAYS[value];
  const label = PRESET_LABELS[value];

  if (days === 0) {
    return { value, label, since: null, until: null };
  }

  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);
  // Presets run to "now", so the upper bound stays open. Leaving it null
  // rather than pinning it to today keeps a row stamped later today (a sync
  // that ran an hour ago) inside the window.
  return { value, label, since, until: null };
}

/**
 * The Prisma `where` fragment for a resolved range.
 *
 * Every page filtering insights should go through this instead of writing
 * `{ date: { gte: ... } }` by hand. Before custom ranges those hand-written
 * filters were all equivalent; now one that forgets `lte` silently reports a
 * wider window than the user selected, and looks completely normal doing it.
 */
export function insightsDateFilter(
  range: ResolvedDateRange,
): { date?: { gte?: Date; lte?: Date } } {
  if (!range.since && !range.until) return {};
  return {
    date: {
      ...(range.since ? { gte: range.since } : {}),
      ...(range.until ? { lte: range.until } : {}),
    },
  };
}
