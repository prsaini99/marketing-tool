"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Stethoscope } from "lucide-react";
import { DIAGNOSIS_QUESTIONS } from "@/lib/diagnosis-questions";

/**
 * One-click diagnosis.
 *
 * The product already has a full chat assistant, and this exists anyway
 * because a chat box asks the user to know what to ask. Most people opening
 * an account have the same five questions and no appetite for phrasing them;
 * turning those into buttons is the difference between a feature people
 * admire and one they use.
 *
 * The answer renders INLINE rather than opening a chat thread. A click here
 * persists nothing — no ChatThread, no ChatMessage — so the chat sidebar
 * doesn't fill with one-line threads nobody opens.
 *
 * The period is always shown alongside the answer. The context is anchored
 * to the latest insights day, not to today, so on an account whose sync has
 * fallen behind the answer is about a window that ended some time ago —
 * stating which is the difference between a stale answer and a wrong one.
 */

interface Result {
  questionId: string;
  label: string;
  answer: string;
  period: { from: string; to: string };
  accountName: string;
}

export function DiagnosisButtons({
  metaAdAccountId,
}: {
  metaAdAccountId: string;
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(questionId: string) {
    setLoadingId(questionId);
    setError(null);
    try {
      const res = await fetch("/api/ai/diagnose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metaAdAccountId, questionId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Diagnosis failed");
      setResult(json as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Diagnosis failed");
      setResult(null);
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <section className="rounded-lg border border-border">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Stethoscope className="h-4 w-4 text-muted" />
        <div>
          <h2 className="text-sm font-semibold">Ask about this account</h2>
          <p className="text-xs text-muted">
            Answers grounded in this account&apos;s own numbers.
          </p>
        </div>
      </header>

      <div className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {DIAGNOSIS_QUESTIONS.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => ask(q.id)}
              disabled={loadingId !== null}
              title={q.hint}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-40 ${
                result?.questionId === q.id
                  ? "border-accent bg-accent-subtle text-foreground"
                  : "border-border hover:bg-surface-2"
              }`}
            >
              {loadingId === q.id && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {q.label}
            </button>
          ))}
        </div>

        {error && <p className="mt-3 text-xs text-danger">{error}</p>}

        {loadingId && !result && (
          <p className="mt-3 text-sm text-muted">Reading the account…</p>
        )}

        {result && (
          <article className="mt-3 rounded-md border border-border bg-surface px-3 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold">{result.label}</h3>
              <span className="text-xs text-muted">
                {result.period.from} → {result.period.to}
              </span>
            </div>
            <div className="prose prose-sm mt-1.5 max-w-none text-sm [&_li]:my-0.5 [&_p]:my-1.5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {result.answer}
              </ReactMarkdown>
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
