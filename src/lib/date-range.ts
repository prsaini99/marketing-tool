/**
 * Date range presets surfaced via the `?range=` URL param.
 *
 * Single source of truth for both the dropdown UI and the server-side
 * page queries. Add a preset here → both update in lockstep.
 *
 * `since = null` means "no lower bound" (i.e. all-time aggregation).
 */

export const DEFAULT_RANGE_VALUE = "7d";

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
  // `since` is `null` for "all time"; otherwise the UTC start-of-day boundary.
  since: Date | null;
}

export function resolveDateRange(
  raw: string | null | undefined,
): ResolvedDateRange {
  const value =
    raw && PRESET_DAYS[raw] !== undefined ? raw : DEFAULT_RANGE_VALUE;
  const days = PRESET_DAYS[value];
  const label = PRESET_LABELS[value];

  if (days === 0) {
    return { value, label, since: null };
  }

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);
  return { value, label, since };
}
