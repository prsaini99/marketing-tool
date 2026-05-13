/**
 * Schedule presets — single source of truth for what frequencies exist,
 * how to compute their next run time, and how many Meta API calls each
 * costs per day. Used by both the UI dropdown and the tick endpoint.
 *
 * "off" means the schedule is disabled — kept as a sentinel so the UI
 * can present a single dropdown rather than a toggle + dropdown.
 */

export type ScheduleKind = "campaigns" | "adsets" | "ads" | "insights";
export const SCHEDULE_KINDS: ScheduleKind[] = [
  "campaigns",
  "adsets",
  "ads",
  "insights",
];

export type FrequencyKey =
  | "off"
  | "hourly"
  | "every_6h"
  | "daily"
  | "every_3d"
  | "weekly";

export interface FrequencyPreset {
  key: FrequencyKey;
  label: string;
  runsPerDay: number; // 0 for "off"
}

export const FREQUENCY_PRESETS: FrequencyPreset[] = [
  { key: "off", label: "Off", runsPerDay: 0 },
  { key: "hourly", label: "Hourly", runsPerDay: 24 },
  { key: "every_6h", label: "Every 6 hours", runsPerDay: 4 },
  { key: "daily", label: "Daily", runsPerDay: 1 },
  { key: "every_3d", label: "Every 3 days", runsPerDay: 1 / 3 },
  { key: "weekly", label: "Weekly", runsPerDay: 1 / 7 },
];

export function isFrequencyKey(v: string | undefined | null): v is FrequencyKey {
  return !!v && FREQUENCY_PRESETS.some((p) => p.key === v);
}

export function frequencyLabel(key: FrequencyKey): string {
  return FREQUENCY_PRESETS.find((p) => p.key === key)?.label ?? key;
}

// Stable anchor for "every 3 days" so runs align across the user base rather
// than drifting based on when each schedule was first saved.
const ANCHOR_EVERY_3D = new Date(Date.UTC(2026, 0, 1, 2, 0, 0));

/**
 * Returns the next firing time strictly AFTER `now`. Returns null for "off".
 * All times are UTC. Daily runs anchor to 02:00 UTC.
 */
export function computeNextRun(
  frequency: FrequencyKey,
  now: Date = new Date(),
): Date | null {
  if (frequency === "off") return null;

  if (frequency === "hourly") {
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }

  if (frequency === "every_6h") {
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    const h = next.getUTCHours();
    next.setUTCHours(Math.ceil((h + 1) / 6) * 6);
    return next;
  }

  if (frequency === "daily") {
    const next = new Date(now);
    next.setUTCHours(2, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return next;
  }

  if (frequency === "every_3d") {
    const dayMs = 24 * 3_600_000;
    const diffMs = now.getTime() - ANCHOR_EVERY_3D.getTime();
    const periodsSince = Math.floor(diffMs / (3 * dayMs));
    let next = new Date(
      ANCHOR_EVERY_3D.getTime() + (periodsSince + 1) * 3 * dayMs,
    );
    if (next.getTime() <= now.getTime()) {
      next = new Date(next.getTime() + 3 * dayMs);
    }
    return next;
  }

  if (frequency === "weekly") {
    const next = new Date(now);
    next.setUTCHours(2, 0, 0, 0);
    const daysToSunday = (7 - next.getUTCDay()) % 7;
    next.setUTCDate(next.getUTCDate() + daysToSunday);
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 7);
    }
    return next;
  }

  return null;
}

// Per-kind API-call cost per run. Insights fans out across 4 levels in
// parallel; the rest are single endpoint calls. Used to surface the
// estimated daily Meta cost in the UI.
const CALLS_PER_RUN: Record<ScheduleKind, number> = {
  campaigns: 1,
  adsets: 1,
  ads: 1,
  insights: 4,
};

export function callsPerDay(kind: ScheduleKind, frequency: FrequencyKey): number {
  const preset = FREQUENCY_PRESETS.find((p) => p.key === frequency);
  if (!preset) return 0;
  return preset.runsPerDay * CALLS_PER_RUN[kind];
}

export interface ScheduleEntry {
  kind: ScheduleKind;
  frequency: FrequencyKey;
}

export function estimateDailyCalls(entries: ScheduleEntry[]): number {
  return entries.reduce(
    (sum, e) => sum + callsPerDay(e.kind, e.frequency),
    0,
  );
}
