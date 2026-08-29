"use client";

import {
  AD_FORMATS,
  getFormat,
  type FormatIntent,
  type FormatNeeds,
} from "@/server/services/ai/ad-formats";

/**
 * Format picker for Ad Studio — a single <select> grouped by intent, plus a
 * "Free-form brief" escape hatch that keeps the pre-format behaviour intact.
 * Selecting a format surfaces its `needs` requirement and `failureMode` hint
 * right under the control so the operator sees the constraint before they
 * hit Generate, not after a 400.
 */

const INTENT_LABEL: Record<FormatIntent, string> = {
  awareness: "Awareness",
  consideration: "Consideration",
  conversion: "Conversion",
};

const INTENT_ORDER: FormatIntent[] = ["awareness", "consideration", "conversion"];

const NEEDS_LABEL: Record<FormatNeeds, string> = {
  none: "",
  product: "Needs a product photo.",
  proof: "Needs a real photo — the result, the customer, or the founder.",
};

interface FormatPickerProps {
  value: string;
  onChange: (id: string) => void;
}

export function FormatPicker({ value, onChange }: FormatPickerProps) {
  const format = value ? getFormat(value) : null;

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">Format</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <option value="">Free-form brief</option>
        {INTENT_ORDER.map((intent) => {
          const options = AD_FORMATS.filter((f) => f.intent === intent);
          if (options.length === 0) return null;
          return (
            <optgroup key={intent} label={INTENT_LABEL[intent]}>
              {options.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      {format && (
        <div className="space-y-0.5 text-[11px] text-muted">
          {format.needs !== "none" && <p>{NEEDS_LABEL[format.needs]}</p>}
          <p>Watch out: {format.failureMode}</p>
        </div>
      )}
    </div>
  );
}
