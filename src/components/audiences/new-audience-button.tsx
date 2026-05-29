"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  CreateAudienceModal,
  type AudienceAccountOption,
} from "./create-audience-modal";

interface NewAudienceButtonProps {
  // Selected-for-sync accounts the user can create an audience under,
  // scoped to the active client filter on the Audiences page.
  accounts: AudienceAccountOption[];
}

export function NewAudienceButton({ accounts }: NewAudienceButtonProps) {
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
            ? "No selected-for-sync ad accounts to create an audience under"
            : "Create a customer-list audience"
        }
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        New audience
      </button>
      <CreateAudienceModal
        open={open}
        accounts={accounts}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
