"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SlideOverProps {
  open: boolean;
  title: string;
  /** Optional line under the title — say which thing is being edited. */
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  /** Tailwind max-width for the panel. Defaults to a comfortable form width. */
  widthClass?: string;
}

/**
 * Right-edge slide-over panel, for editing something occasional beside work
 * that is constant. Follows ConfirmModal's conventions (portal to body,
 * scroll lock, ESC to close, contained click/keydown) with two deliberate
 * differences:
 *
 *  - Clicking the backdrop DOES close it. ConfirmModal makes the backdrop
 *    inert because dismissing a confirm by accident loses a decision; a
 *    drawer holds an editor you can reopen, so trapping the user is the
 *    worse failure.
 *  - The children stay MOUNTED while closed (the panel is translated off
 *    screen, not unmounted). A drawer holding a half-typed form must not
 *    silently discard it because someone pressed Escape.
 *
 * That second point is why this is not just a modal with different CSS:
 * `open` drives a transform, never a return-null.
 */
export function SlideOver({
  open,
  title,
  subtitle,
  children,
  onClose,
  widthClass = "max-w-2xl",
}: SlideOverProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Only the portal itself waits for mount — never the panel's contents,
  // which must survive open/close cycles with their state intact.
  if (!mounted) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50",
        // pointer-events-none while closed so the off-screen panel and its
        // backdrop can't swallow clicks meant for the page underneath.
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/40 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
      />

      <aside
        role="dialog"
        aria-modal={open}
        aria-hidden={!open}
        aria-labelledby="slide-over-title"
        className={cn(
          "absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-background shadow-xl transition-transform duration-200 ease-out",
          widthClass,
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h2
              id="slide-over-title"
              className="text-sm font-semibold tracking-tight text-foreground"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-[11px] text-subtle">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            // Unreachable by keyboard while closed, so a tab sweep of the
            // page doesn't land inside a hidden panel.
            tabIndex={open ? 0 : -1}
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
