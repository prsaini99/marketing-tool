/**
 * The canned diagnosis questions.
 *
 * These are prompts, so most of their quality is not testable — but three
 * properties are, and all three are the kind of thing that silently rots:
 * ids stay stable (the UI and any saved state key off them), every question
 * carries a real analytical instruction rather than just a label, and the
 * anti-fabrication clause reaches every prompt. That last one is what keeps
 * the feature honest on thin or stale accounts, which is exactly when a
 * model is most tempted to invent a cause.
 */

import { describe, expect, it } from "vitest";
import {
  buildDiagnosisPrompt,
  DIAGNOSIS_QUESTIONS,
  getQuestion,
} from "@/lib/diagnosis-questions";

describe("DIAGNOSIS_QUESTIONS", () => {
  it("exposes a small, curated set", () => {
    // A button row, not a menu. If this grows past ~6 it has become the
    // chat assistant with extra steps.
    expect(DIAGNOSIS_QUESTIONS.length).toBeGreaterThan(2);
    expect(DIAGNOSIS_QUESTIONS.length).toBeLessThanOrEqual(6);
  });

  it("has unique, stable, slug-style ids", () => {
    const ids = DIAGNOSIS_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("gives every question a label, a hint and a real instruction", () => {
    for (const q of DIAGNOSIS_QUESTIONS) {
      expect(q.label.length, q.id).toBeGreaterThan(0);
      expect(q.hint.length, q.id).toBeGreaterThan(0);
      // An instruction that is merely the label restated teaches the model
      // nothing — the analytical frame is the whole value.
      expect(q.instruction.length, q.id).toBeGreaterThan(q.label.length * 3);
    }
  });

  it("keeps labels short enough to sit on a button", () => {
    for (const q of DIAGNOSIS_QUESTIONS) {
      expect(q.label.length, q.id).toBeLessThanOrEqual(32);
    }
  });
});

describe("getQuestion", () => {
  it("finds a known question", () => {
    expect(getQuestion("what_changed")?.label).toBeTruthy();
  });

  it("returns null for an unknown id rather than throwing", () => {
    expect(getQuestion("nope")).toBe(null);
    expect(getQuestion("")).toBe(null);
  });
});

describe("buildDiagnosisPrompt", () => {
  const q = DIAGNOSIS_QUESTIONS[0];
  const OPTS = { currency: "INR", revenueTracked: true };

  it("includes the question's own instruction", () => {
    const p = buildDiagnosisPrompt(q, "{}", OPTS);
    expect(p).toContain(q.instruction);
  });

  it("includes the anti-fabrication clause for every question", () => {
    for (const question of DIAGNOSIS_QUESTIONS) {
      const p = buildDiagnosisPrompt(question, "{}", OPTS);
      expect(p, question.id).toMatch(/never invent/i);
      expect(p, question.id).toMatch(/too thin or too stale/i);
    }
  });

  it("includes a length limit so answers stay scannable", () => {
    expect(buildDiagnosisPrompt(q, "{}", OPTS)).toMatch(/at most 120 words/i);
  });

  it("puts the data payload last", () => {
    const p = buildDiagnosisPrompt(q, '{"marker":true}', OPTS);
    expect(p.indexOf(q.instruction)).toBeLessThan(p.indexOf('{"marker":true}'));
    expect(p.trimEnd().endsWith('{"marker":true}')).toBe(true);
  });

  it("passes the context through verbatim", () => {
    const ctx = JSON.stringify({ totals: { current: { spendCents: 123 } } });
    expect(buildDiagnosisPrompt(q, ctx, OPTS)).toContain(ctx);
  });
});

describe("buildDiagnosisPrompt — units and revenue framing", () => {
  const q = DIAGNOSIS_QUESTIONS[0];

  it("tells the model amounts are already in major units", () => {
    // The service converts cents before serialising; the prompt must not
    // then invite a second division.
    const p = buildDiagnosisPrompt(q, "{}", {
      currency: "INR",
      revenueTracked: true,
    });
    expect(p).toMatch(/already in INR/i);
    expect(p).toMatch(/never multiply or divide/i);
  });

  it("names the account's own currency", () => {
    const p = buildDiagnosisPrompt(q, "{}", {
      currency: "USD",
      revenueTracked: true,
    });
    expect(p).toContain("USD");
    expect(p).not.toContain("INR");
  });

  it("warns off ROAS conclusions when no revenue is tracked", () => {
    // Lead-gen accounts have structurally zero ROAS; reading that as
    // failure produces confident "pause this campaign" advice on a
    // campaign that is converting well.
    const p = buildDiagnosisPrompt(q, "{}", {
      currency: "INR",
      revenueTracked: false,
    });
    expect(p).toMatch(/lead-generation account/i);
    expect(p).toMatch(/never recommend pausing anything on that basis/i);
    expect(p).toMatch(/cost per conversion/i);
  });

  it("allows ROAS reasoning when revenue IS tracked", () => {
    const p = buildDiagnosisPrompt(q, "{}", {
      currency: "INR",
      revenueTracked: true,
    });
    expect(p).toMatch(/ROAS is meaningful/i);
    expect(p).not.toMatch(/lead-generation account/i);
  });
});
