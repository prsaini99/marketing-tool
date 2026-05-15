"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { CreateAdSetModal } from "./create-adset-modal";

interface NewAdSetButtonProps {
  campaign: {
    metaCampaignId: string;
    name: string;
    objective: string;
    hasCbo: boolean;
  };
  currency: string;
  defaultCountry?: string;
}

export function NewAdSetButton({
  campaign,
  currency,
  defaultCountry,
}: NewAdSetButtonProps) {
  const [open, setOpen] = useState(false);
  const disabled = !campaign.metaCampaignId;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={
          disabled
            ? "Parent campaign not loaded yet"
            : "Create a new ad set under this campaign"
        }
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        New ad set
      </button>
      <CreateAdSetModal
        open={open}
        campaign={campaign}
        currency={currency}
        defaultCountry={defaultCountry}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
