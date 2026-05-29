"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  CreateConversionModal,
  type ConversionAccountOption,
} from "./create-conversion-modal";

interface NewConversionButtonProps {
  accounts: ConversionAccountOption[];
}

export function NewConversionButton({ accounts }: NewConversionButtonProps) {
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
            ? "No selected-for-sync ad accounts to create a conversion under"
            : "Create a custom conversion"
        }
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        New conversion
      </button>
      <CreateConversionModal
        open={open}
        accounts={accounts}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
