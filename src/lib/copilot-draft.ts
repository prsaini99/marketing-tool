/**
 * Local persistence for an in-progress campaign plan.
 *
 * WHY THIS EXISTS. The plan lived in React state alone, so a refresh, a
 * navigation to another page, or switching the account chip threw away work
 * someone may have spent minutes editing. Losing an edited plan to a
 * misclick is the kind of thing that stops people trusting a tool with
 * anything they care about.
 *
 * WHY localStorage AND NOT THE DATABASE. A draft is one person's
 * work-in-progress on one machine, and nothing else in the product reads it.
 * A server-side draft model would buy sharing between users and devices, at
 * the cost of a table, a migration, save/load endpoints and a draft list.
 * That is worth building when someone wants to hand a draft to a colleague;
 * it is not worth building to stop a refresh losing work.
 *
 * Drafts are keyed per ad account, so switching accounts shows that
 * account's draft rather than bleeding one client's plan into another's
 * screen.
 *
 * Everything here is defensive. A corrupt or half-written entry must never
 * break the page: a draft is a convenience, and the cost of failing to read
 * one is starting over, which is exactly where the user would have been
 * anyway.
 */

const VERSION = 1;
const PREFIX = "adsboys.copilot.draft";

/**
 * Drafts older than this are ignored on read.
 *
 * A plan is built against a snapshot of the account: budgets, audiences and
 * the creative library all move. Restoring a fortnight-old draft would offer
 * someone a plan referencing assets that may no longer exist, which is worse
 * than offering nothing.
 */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CopilotDraft<TResult, TPlan> {
  version: number;
  savedAt: number;
  result: TResult;
  edited: TPlan | null;
  pinned: string[];
}

function key(adAccountId: string): string {
  return `${PREFIX}.${adAccountId}`;
}

export function saveDraft<TResult, TPlan>(
  adAccountId: string,
  draft: Omit<CopilotDraft<TResult, TPlan>, "version" | "savedAt">,
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: CopilotDraft<TResult, TPlan> = {
      version: VERSION,
      savedAt: Date.now(),
      ...draft,
    };
    window.localStorage.setItem(key(adAccountId), JSON.stringify(payload));
  } catch {
    // Quota exceeded, private browsing, storage disabled. A draft that
    // cannot be saved is not worth an error: the plan on screen still works.
  }
}

export function loadDraft<TResult, TPlan>(
  adAccountId: string,
): CopilotDraft<TResult, TPlan> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(adAccountId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CopilotDraft<TResult, TPlan>;
    // A draft written by an older shape is discarded rather than migrated.
    // The plan schema is still moving, and restoring something the current
    // validator cannot read would surface as a wall of nonsense errors.
    if (parsed.version !== VERSION) return null;
    if (!parsed.result) return null;
    if (Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      clearDraft(adAccountId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(adAccountId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(adAccountId));
  } catch {
    /* nothing useful to do */
  }
}

/** "3 minutes ago", for the restored-draft notice. */
export function describeAge(savedAt: number, now: number = Date.now()): string {
  const ms = Math.max(0, now - savedAt);
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
