import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDraft,
  describeAge,
  DRAFT_MAX_AGE_MS,
  loadDraft,
  saveDraft,
} from "@/lib/copilot-draft";

/** Minimal localStorage, since these tests run in node. */
function installStorage() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal("window", { localStorage: mock });
  return store;
}

interface Result { currency: string }
interface Plan { name: string }

const result: Result = { currency: "INR" };
const plan: Plan = { name: "Q3" };

describe("draft persistence", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installStorage();
  });

  it("round-trips a draft", () => {
    saveDraft<Result, Plan>("acct1", { result, edited: plan, pinned: ["image:abc"] });
    const back = loadDraft<Result, Plan>("acct1");
    expect(back?.result).toEqual(result);
    expect(back?.edited).toEqual(plan);
    expect(back?.pinned).toEqual(["image:abc"]);
  });

  it("keys drafts per account, so one client's plan cannot appear under another", () => {
    saveDraft<Result, Plan>("acct1", { result, edited: plan, pinned: [] });
    expect(loadDraft<Result, Plan>("acct2")).toBeNull();
  });

  it("returns null when nothing was saved", () => {
    expect(loadDraft<Result, Plan>("acct1")).toBeNull();
  });

  it("discards a draft older than the maximum age", () => {
    // A plan is built against a snapshot of the account. Restoring a
    // fortnight-old draft offers assets and budgets that may not exist.
    saveDraft<Result, Plan>("acct1", { result, edited: plan, pinned: [] });
    const raw = JSON.parse(store.get("adsboys.copilot.draft.acct1")!);
    raw.savedAt = Date.now() - DRAFT_MAX_AGE_MS - 1000;
    store.set("adsboys.copilot.draft.acct1", JSON.stringify(raw));
    expect(loadDraft<Result, Plan>("acct1")).toBeNull();
  });

  it("removes an expired draft rather than leaving it to be read again", () => {
    saveDraft<Result, Plan>("acct1", { result, edited: plan, pinned: [] });
    const raw = JSON.parse(store.get("adsboys.copilot.draft.acct1")!);
    raw.savedAt = Date.now() - DRAFT_MAX_AGE_MS - 1000;
    store.set("adsboys.copilot.draft.acct1", JSON.stringify(raw));
    loadDraft<Result, Plan>("acct1");
    expect(store.has("adsboys.copilot.draft.acct1")).toBe(false);
  });

  it("discards a draft written by an older version rather than migrating it", () => {
    // The plan schema is still moving. Restoring a shape the current
    // validator cannot read surfaces as a wall of nonsense errors.
    store.set(
      "adsboys.copilot.draft.acct1",
      JSON.stringify({ version: 0, savedAt: Date.now(), result, edited: plan, pinned: [] }),
    );
    expect(loadDraft<Result, Plan>("acct1")).toBeNull();
  });

  it("survives corrupt JSON without throwing", () => {
    // A half-written entry must never break the page.
    store.set("adsboys.copilot.draft.acct1", "{not json");
    expect(loadDraft<Result, Plan>("acct1")).toBeNull();
  });

  it("clears on request", () => {
    saveDraft<Result, Plan>("acct1", { result, edited: plan, pinned: [] });
    clearDraft("acct1");
    expect(loadDraft<Result, Plan>("acct1")).toBeNull();
  });

  it("does not throw when storage is unavailable", () => {
    // Private browsing and quota errors must degrade to "no draft", not a
    // crash: the plan on screen still works without one.
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(() => saveDraft("acct1", { result, edited: plan, pinned: [] })).not.toThrow();
    expect(loadDraft("acct1")).toBeNull();
    expect(() => clearDraft("acct1")).not.toThrow();
  });
});

describe("describeAge", () => {
  const now = 1_700_000_000_000;
  it("reads naturally across the ranges", () => {
    expect(describeAge(now - 10_000, now)).toBe("just now");
    expect(describeAge(now - 60_000, now)).toBe("1 minute ago");
    expect(describeAge(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(describeAge(now - 60 * 60_000, now)).toBe("1 hour ago");
    expect(describeAge(now - 5 * 3_600_000, now)).toBe("5 hours ago");
    expect(describeAge(now - 26 * 3_600_000, now)).toBe("1 day ago");
    expect(describeAge(now - 72 * 3_600_000, now)).toBe("3 days ago");
  });

  it("never reports a negative age from clock skew", () => {
    expect(describeAge(now + 60_000, now)).toBe("just now");
  });
});
