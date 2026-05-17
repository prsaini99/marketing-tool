"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  CreateAdSetModal,
  type AvailableAudience,
  type AvailableConversion,
} from "./create-adset-modal";

interface NewAdSetButtonProps {
  campaign: {
    metaCampaignId: string;
    name: string;
    objective: string;
    hasCbo: boolean;
  };
  // Meta ad account id (the campaign's parent account). Threaded down to
  // the modal so the live reach-estimate card knows which account to ask.
  metaAdAccountId: string;
  currency: string;
  defaultCountry?: string;
  // Pre-fetched server-side from the AdCreative-parent ad account; passed
  // through to the modal so the Custom audiences picker has its options.
  audiences?: AvailableAudience[];
  // Same idea as `audiences` — saved custom conversions for the picker
  // inside the Promoted object block.
  conversions?: AvailableConversion[];
}

export function NewAdSetButton({
  campaign,
  metaAdAccountId,
  currency,
  defaultCountry,
  audiences,
  conversions,
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
        metaAdAccountId={metaAdAccountId}
        currency={currency}
        defaultCountry={defaultCountry}
        audiences={audiences}
        conversions={conversions}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
