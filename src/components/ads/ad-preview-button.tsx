"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { AdPreviewModal } from "./ad-preview-modal";

interface AdPreviewButtonProps {
  metaAdId: string;
  adName: string;
}

/**
 * Row-level "Preview" icon — opens the multi-placement preview modal for
 * one ad. Used inside row click handlers, so stopPropagation everywhere.
 */
export function AdPreviewButton({ metaAdId, adName }: AdPreviewButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`Preview ${adName}`}
        title="Preview placements"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-subtle transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <Eye className="h-4 w-4" />
      </button>
      <AdPreviewModal
        open={open}
        metaAdId={metaAdId}
        adName={adName}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
