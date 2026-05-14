"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { SyncHistoryModal } from "./sync-history-modal";

interface SyncLog {
  id: string;
  kind: string;
  status: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface SyncHistoryButtonProps {
  logs: SyncLog[];
}

/**
 * Button that opens the recent-sync-history modal. Logs are pre-loaded on
 * the server and passed in — opening the modal does no network work.
 */
export function SyncHistoryButton({ logs }: SyncHistoryButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium hover:bg-surface-2 transition-colors"
      >
        <History className="h-3.5 w-3.5" />
        Sync history
      </button>
      <SyncHistoryModal open={open} logs={logs} onClose={() => setOpen(false)} />
    </>
  );
}
