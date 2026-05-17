"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { CreateAdModal } from "./create-ad-modal";

interface NewAdButtonProps {
  adSet: {
    metaAdSetId: string;
    name: string;
  };
}

export function NewAdButton({ adSet }: NewAdButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        New ad
      </button>
      <CreateAdModal
        open={open}
        adSet={adSet}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
