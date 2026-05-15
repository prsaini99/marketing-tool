"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Calls POST /api/auth/logout to clear the session cookie, then routes the
 * user to /login. router.refresh() makes sure server components re-render
 * with no auth context.
 */
export function SignOutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function signOut() {
    setSubmitting(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={submitting}
      className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-background px-2.5 py-1.5 text-sm font-medium text-danger hover:bg-red-50 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    >
      {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {submitting ? "Signing out…" : "Sign out"}
    </button>
  );
}
