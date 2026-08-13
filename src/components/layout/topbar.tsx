import { AccountSwitcher } from "./account-switcher";
import { BackButton } from "./back-button";
import { UserMenu } from "./user-menu";
import type { AccountBusinessMap } from "@/lib/active-business";

interface TopbarProps {
  businesses: Array<{ id: string; name: string }>;
  accountToBusiness: AccountBusinessMap;
  /**
   * Which role the session belongs to, resolved by the dashboard layout.
   *
   * Needed because the session cookie is an HMAC of a ROLE TAG, not of a user
   * — so the app knows *what kind of* session this is but genuinely cannot
   * know which account it belongs to. Showing MASTER_EMAIL unconditionally
   * (as this did) therefore displayed the owner's personal address to anyone
   * signed in as a reviewer, including Meta's App Review staff.
   */
  role?: "owner" | "reviewer";
}

export function Topbar({ businesses, accountToBusiness, role }: TopbarProps) {
  const isReviewer = role === "reviewer";

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/85 px-4 backdrop-blur-md">
      <div className="flex items-center gap-3">
        {!isReviewer && <BackButton />}
        {isReviewer ? (
          /* No nav for reviewers — no sidebar, no top links. They can reach
             only two pages, and the Automation cards already link straight to
             each account's Inbox, so a nav bar would be chrome around a
             single destination. Just the brand, so the app isn't nameless. */
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-sm font-semibold text-accent-foreground">
              M
            </div>
            <span className="text-sm font-semibold" style={{ fontFamily: "var(--font-display)" }}>adsboys</span>
          </div>
        ) : (
          /* Hidden for reviewers: it switches ad-account/business context,
             which none of the automation pages filter on, so to a reviewer
             it is a prominent control that appears to do nothing. */
          <AccountSwitcher
            businesses={businesses}
            accountToBusiness={accountToBusiness}
          />
        )}
      </div>
      <div className="flex items-center gap-3">
        {/*
          Only the owner's identity is knowable here — that session is
          validated against MASTER_EMAIL, so showing it is accurate. A
          reviewer session carries no identity at all (several reviewer
          accounts share one role tag), so it gets the honest label rather
          than a guess. Showing an email we cannot verify would be worse than
          showing none: it names the wrong person.
        */}
        <UserMenu
          email={
            role === "reviewer"
              ? "Reviewer access"
              : (process.env.MASTER_EMAIL ?? "signed in")
          }
        />
      </div>
    </header>
  );
}
