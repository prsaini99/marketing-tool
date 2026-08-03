"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";

interface UserMenuProps {
  /**
   * The signed-in account's email, supplied by the server component that
   * renders this. Passed in rather than hardcoded: the menu previously
   * displayed a fixed name and email regardless of who was actually signed
   * in, which misleads the moment the credentials differ.
   */
  email: string;
}

export function UserMenu({ email }: UserMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // A master-credential login has no separate name field, so derive a display
  // name from the local part of the email.
  const local = email.split("@")[0] ?? "";
  const name = local ? local.charAt(0).toUpperCase() + local.slice(1) : "User";

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  /**
   * Clear the session cookie server-side, then leave the dashboard.
   *
   * `router.refresh()` after the push is load-bearing: without it the server
   * components stay rendered from their authenticated cache, so navigating
   * back still shows dashboard content until a hard reload — which looks
   * exactly like sign-out having done nothing.
   */
  async function signOut() {
    setSigningOut(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) {
        // Never let a failed sign-out look successful. Parking someone on a
        // login screen while their session cookie is still valid is worse
        // than telling them plainly that it failed.
        setError("Sign out failed. Please try again.");
        setSigningOut(false);
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      setError("Sign out failed. Please try again.");
      setSigningOut(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-foreground hover:bg-border transition-colors"
        aria-label="User menu"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {name[0]}
      </button>

      {/*
        No role="menu"/"menuitem" on the dropdown below, deliberately. Those
        roles promise the full ARIA menu keyboard contract — arrow-key roving
        focus, Home/End, type-ahead — which this component does not implement,
        so declaring them tells a screen-reader user to expect navigation that
        silently does nothing. A plain container of plain buttons is honest and
        works with native Tab order. Add the roles back only alongside the
        keyboard handling they promise.
      */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-border bg-background shadow-md">
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-medium">{name}</p>
            <p className="text-xs text-muted">{email}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {signingOut ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="h-3.5 w-3.5" />
            )}
            <span>{signingOut ? "Signing out…" : "Sign out"}</span>
          </button>
          {error && <p className="px-3 pb-2 text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
