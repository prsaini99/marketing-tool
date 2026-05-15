"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { CreateCampaignModal } from "./create-campaign-modal";

interface AccountOption {
  metaAdAccountId: string;
  name: string;
  currency: string;
  businessName: string;
}

interface NewCampaignButtonProps {
  accounts: AccountOption[];
  // When set, the modal hides the account picker and creates here.
  lockedAdAccountId?: string;
}

/**
 * Header button + modal — works on both /dashboard/campaigns (cross-account
 * with a picker) and account detail pages (locked to one account).
 */
export function NewCampaignButton({
  accounts,
  lockedAdAccountId,
}: NewCampaignButtonProps) {
  const [open, setOpen] = useState(false);
  const disabled = accounts.length === 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={
          disabled
            ? "Select an ad account for sync first"
            : "Create a new campaign on Meta"
        }
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        New campaign
      </button>
      <CreateCampaignModal
        open={open}
        accounts={accounts}
        lockedAdAccountId={lockedAdAccountId}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
