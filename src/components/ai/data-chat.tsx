"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * AI Assistant — persistent, multi-thread chat backed by the tool-using
 * endpoint.
 *
 * Layout: left sidebar lists every thread (newest-first); right side is the
 * active conversation. Server owns the message history — the client only
 * tracks the active threadId + UI-friendly "turns" (one user message + the
 * tools fired + the final assistant text).
 *
 * Threads are auto-titled from the first user message and bumped to the top
 * of the list whenever they receive a new turn. Deleting a thread cascades
 * its messages.
 */

interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface DisplayTurn {
  userContent: string;
  toolsUsed: string[];
  assistantContent: string;
  busy?: boolean;
  error?: string | null;
}

const SUGGESTED_PROMPTS = [
  "How many campaigns are running across all accounts?",
  "Which accounts spent the most this week?",
  "Show me the top 5 campaigns by spend in the last 7 days.",
  "Why are so many campaigns showing no delivery?",
];

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(d);
}

export function DataChat() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [loadingTurns, setLoadingTurns] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Load thread list on mount.
  useEffect(() => {
    fetch("/api/ai/chat/threads")
      .then((r) => r.json())
      .then((d) => setThreads(Array.isArray(d.threads) ? d.threads : []))
      .catch(() => {
        /* sidebar empty — non-fatal */
      });
  }, []);

  const loadThread = useCallback(async (id: string | null) => {
    setActiveId(id);
    setTurns([]);
    if (!id) return;
    setLoadingTurns(true);
    try {
      const r = await fetch(`/api/ai/chat/threads/${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setTurns(Array.isArray(d.turns) ? d.turns : []);
    } catch {
      setTurns([]);
    } finally {
      setLoadingTurns(false);
    }
  }, []);

  // Auto-scroll the message pane to the latest message.
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [turns, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const optimistic: DisplayTurn = {
      userContent: trimmed,
      toolsUsed: [],
      assistantContent: "",
      busy: true,
      error: null,
    };
    setTurns((t) => [...t, optimistic]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: activeId,
          content: trimmed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);

      // Persist server's threadId if this was a new thread.
      const returnedId = String(data.threadId ?? "");
      const returnedTitle = String(data.threadTitle ?? "Untitled chat");

      setTurns((t) => {
        const copy = [...t];
        copy[copy.length - 1] = {
          userContent: trimmed,
          toolsUsed: Array.isArray(data.toolsUsed) ? data.toolsUsed : [],
          assistantContent: String(data.reply ?? ""),
          busy: false,
          error: null,
        };
        return copy;
      });

      // Add to (or refresh) the sidebar list. Bump the active thread up.
      setThreads((curr) => {
        const others = curr.filter((t) => t.id !== returnedId);
        return [
          {
            id: returnedId,
            title: returnedTitle,
            updatedAt: new Date().toISOString(),
          },
          ...others,
        ];
      });

      if (!activeId) setActiveId(returnedId);
    } catch (err) {
      setTurns((t) => {
        const copy = [...t];
        copy[copy.length - 1] = {
          ...optimistic,
          busy: false,
          error: err instanceof Error ? err.message : "Chat failed",
        };
        return copy;
      });
      setInput(trimmed);
    } finally {
      setBusy(false);
    }
  }

  async function deleteThread(id: string) {
    if (busy) return;
    const ok = window.confirm(
      "Delete this chat? The conversation history will be lost.",
    );
    if (!ok) return;
    try {
      await fetch(`/api/ai/chat/threads/${id}`, { method: "DELETE" });
    } catch {
      /* swallow — UI will still drop it */
    }
    setThreads((curr) => curr.filter((t) => t.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setTurns([]);
    }
  }

  function startNewChat() {
    if (busy) return;
    setActiveId(null);
    setTurns([]);
    setInput("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] overflow-hidden rounded-md border border-border bg-background">
      {/* ── Left: thread list ─────────────────────────────────────── */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border p-2">
          <button
            type="button"
            onClick={startNewChat}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {threads.length === 0 ? (
            <p className="px-2 pt-4 text-center text-[11px] text-subtle">
              No conversations yet. Ask a question on the right to start one.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {threads.map((t) => (
                <li key={t.id}>
                  <div
                    className={cn(
                      "group flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors",
                      activeId === t.id
                        ? "bg-background"
                        : "hover:bg-background",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => loadThread(t.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div
                        className={cn(
                          "line-clamp-2 leading-snug",
                          activeId === t.id
                            ? "font-medium text-foreground"
                            : "text-foreground",
                        )}
                      >
                        {t.title}
                      </div>
                      <div className="mt-0.5 text-[10px] text-subtle">
                        {formatRelative(t.updatedAt)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteThread(t.id)}
                      title="Delete chat"
                      className="rounded p-1 text-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-danger group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* ── Right: chat ───────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="h-4 w-4 text-accent" />
          <div>
            <div className="text-sm font-semibold text-foreground">
              AI Assistant
            </div>
            <p className="text-[11px] text-subtle">
              Asks the database directly — every answer is queried, never
              guessed.
            </p>
          </div>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4">
          {loadingTurns ? (
            <div className="flex items-center justify-center py-10 text-xs text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading conversation…
            </div>
          ) : turns.length === 0 ? (
            <div className="mx-auto max-w-xl space-y-4 py-12 text-center">
              <MessageSquare className="mx-auto h-8 w-8 text-accent" />
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {activeId
                    ? "This chat is empty"
                    : "Ask anything about your accounts"}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  I can look up campaigns, ad sets, ads, and insights across
                  every account selected for sync.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => send(p)}
                    className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-surface-2"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {turns.map((t, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg rounded-br-sm bg-accent/15 px-3 py-2 text-sm text-foreground">
                      {t.userContent}
                    </div>
                  </div>

                  {t.toolsUsed.length > 0 && (
                    <div className="flex justify-start">
                      <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-muted">
                        <Wrench className="h-3 w-3" />
                        {[...new Set(t.toolsUsed)].join(" · ")}
                      </div>
                    </div>
                  )}

                  {t.busy && (
                    <div className="flex justify-start">
                      <div className="inline-flex items-center gap-1.5 rounded-lg rounded-bl-sm bg-surface px-3 py-2 text-sm text-muted">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Looking it up…
                      </div>
                    </div>
                  )}
                  {t.error && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
                      {t.error}
                    </div>
                  )}
                  {t.assistantContent.trim() && (
                    <div className="flex justify-start">
                      <div
                        className={cn(
                          "max-w-[85%] rounded-lg rounded-bl-sm bg-surface px-3 py-2 text-sm text-foreground",
                          "[&_p]:my-1 [&_p]:leading-6",
                          "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-0.5",
                          "[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-0.5",
                          "[&_strong]:font-semibold",
                          "[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]",
                          "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
                          "[&_th]:border [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
                          "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
                        )}
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {t.assistantContent}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border px-3 py-2">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy}
              placeholder="Ask anything about your accounts…"
              className="max-h-32 min-h-[38px] flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => send(input)}
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="inline-flex h-[38px] items-center gap-1 rounded-md bg-accent px-3 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <p className="mx-auto mt-1 max-w-3xl text-[10px] text-subtle">
            Enter to send · Shift+Enter for newline · queries the DB
            directly, no guessing
          </p>
        </div>
      </div>
    </div>
  );
}
