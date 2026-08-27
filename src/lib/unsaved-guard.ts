/**
 * Tiny cross-component "are there unsaved variants" guard.
 *
 * Why this exists: AccountSwitcher.navigate() (src/components/layout/
 * account-switcher.tsx) calls router.push() directly from a <button> click,
 * which neither of Ad Studio's existing guards can see — beforeunload does
 * not fire for the App Router's client-side navigation, and the anchor-click
 * interceptor in studio-client.tsx only intercepts <a> elements, not the
 * switcher's <button> rows. Left alone, switching clients from the topbar
 * silently discards unsaved (possibly paid-for `high`-quality) variants and
 * navigates away with no warning.
 *
 * Rather than hardcode studio-specific knowledge into the shared switcher
 * (which every dashboard page uses) or monkey-patch next/navigation's
 * router, any page that wants "confirm before some navigation outside its
 * own control discards work" registers a plain predicate here; a caller
 * that navigates through such a path (currently just the switcher) consults
 * confirmDiscard() first. Deliberately framework-free — no React import —
 * so both a "use client" page and a shared nav component can use it without
 * either depending on the other's internals.
 */

let guard: (() => boolean) | null = null;

/**
 * Registers (or clears, with null) the current "has unsaved work" check.
 * Callers should register on mount and clear on unmount so a stale guard
 * from an unmounted page can never block navigation elsewhere.
 */
export function setUnsavedGuard(fn: (() => boolean) | null): void {
  guard = fn;
}

/**
 * Returns true if the navigation calling this should proceed. When a guard
 * is registered and currently reports unsaved work, prompts the user (this
 * module has no UI of its own, so a native confirm is the only synchronous
 * option) and returns their choice. Returns true immediately — no prompt —
 * when nothing is registered or nothing is unsaved.
 */
export function confirmDiscard(message: string): boolean {
  if (!guard || !guard()) return true;
  return window.confirm(message);
}
