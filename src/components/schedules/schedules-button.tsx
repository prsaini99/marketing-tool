"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { SchedulesModal } from "./schedules-modal";

interface SchedulesButtonProps {
  // Unprefixed metaAdAccountId (URL form used throughout the app).
  accountIdUrl: string;
  accountName: string;
}

/**
 * Header button on the account detail page that opens the Auto-sync
 * schedules modal. Replaces the old AccountRowMenu entry — verbs live
 * with their entity, not behind a hidden menu.
 */
export function SchedulesButton({
  accountIdUrl,
  accountName,
}: SchedulesButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium hover:bg-surface-2 transition-colors"
      >
        <Clock className="h-3.5 w-3.5" />
        Schedules
      </button>
      {open && (
        <SchedulesModal
          accountIdUrl={accountIdUrl}
          accountName={accountName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
