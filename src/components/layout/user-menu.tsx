"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";

// Mocked until Supabase Auth wires up. Replace with session lookup.
const mockUser = {
  name: "Pranav",
  email: "pranav@11point2.in",
};

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-foreground hover:bg-border transition-colors"
        aria-label="User menu"
      >
        {mockUser.name[0]}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-border bg-background shadow-md">
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-medium">{mockUser.name}</p>
            <p className="text-xs text-muted">{mockUser.email}</p>
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
