"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ConfirmModal } from "@/components/ui/confirm-modal";

type Action = "take_over" | "return_to_bot" | "resolve" | "send";

interface InboxThreadProps {
  threadId: string;
  ownership: "BOT" | "HUMAN";
  /** Anchor for the reply window — passed through for display only. */
  lastInboundAt: string | Date | null;
  /**
   * Computed server-side via replyWindowState() so the client never
   * re-derives the window boundary from a possibly stale clock.
   *
   * Declared inline rather than imported from
   * `@/server/services/automation/inbox` — that module pulls in Prisma, and
   * this is a client component; importing the type there would drag the
   * whole Prisma import graph into the client bundle.
   */
  windowState: "OPEN" | "HUMAN_AGENT" | "CLOSED" | "NEVER_MESSAGED";
  /**
   * True when this thread is currently in the Needs attention queue
   * (`flagReason` set and not yet resolved). Clearing the flag is the ONLY
   * thing the resolve action does, so the button is hidden when there is no
   * flag — a control that silently does nothing is worse than no control.
   */
  flagged: boolean;
}

async function postAction(
  threadId: string,
  action: Action,
  text?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // The fetch itself must be INSIDE the try. Offline/DNS/aborted requests
  // reject rather than resolve, and a rejection escaping this function leaves
  // every caller's `pending` state set forever — the buttons stay disabled and
  // the inbox looks frozen with no error shown.
  let res: Response;
  try {
    res = await fetch(`/api/automation/threads/${threadId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, text }),
    });
  } catch {
    return { ok: false, error: "Request failed. Check your connection." };
  }
  try {
    return (await res.json()) as { ok: true } | { ok: false; error: string };
  } catch {
    return { ok: false, error: `Request failed (${res.status}).` };
  }
}

export function InboxThread({
  threadId,
  ownership,
  windowState,
  flagged,
}: InboxThreadProps) {
  const router = useRouter();
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    "return_to_bot" | "resolve" | null
  >(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [text, setText] = useState("");

  /**
   * Why replying is impossible, or null when it is possible. Derived once so
   * the bot-owned warning and the human-owned notice cannot drift apart.
   */
  const blockedReason =
    windowState === "CLOSED"
      ? "Meta's 7-day human-agent reply limit has passed for this conversation. The customer needs to message again before you can reply."
      : windowState === "NEVER_MESSAGED"
        ? "This person has never sent a direct message on this thread, so there's nothing to reply to yet."
        : null;

  async function runSimple(action: "take_over" | "return_to_bot" | "resolve") {
    setPending(action);
    setError(null);
    setConfirmError(null);
    const result = await postAction(threadId, action);
    setPending(null);
    if (!result.ok) {
      if (action === "return_to_bot" || action === "resolve") {
        setConfirmError(result.error);
      } else {
        setError(result.error);
      }
      return;
    }
    setConfirmAction(null);
    router.refresh();
  }

  async function send() {
    const body = text.trim();
    if (!body) return;
    setPending("send");
    setError(null);
    const result = await postAction(threadId, "send", body);
    setPending(null);
    if (!result.ok) {
      // Never let a failed send look successful — leave the draft in the box
      // so the operator can retry rather than silently losing the text.
      setError(result.error);
      return;
    }
    setText("");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {ownership === "BOT" && (
          <button
            type="button"
            onClick={() => void runSimple("take_over")}
            disabled={pending !== null}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending === "take_over" && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Take over
          </button>
        )}
        {ownership === "HUMAN" && (
          <button
            type="button"
            onClick={() => setConfirmAction("return_to_bot")}
            disabled={pending !== null}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Return to bot
          </button>
        )}
        {/* Only meaningful while a flag exists — see `flagged` on the props. */}
        {flagged && (
          <button
            type="button"
            onClick={() => setConfirmAction("resolve")}
            disabled={pending !== null}
            title="Removes this conversation from the Needs attention queue. Does not change who is handling it."
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear flag
          </button>
        )}
      </div>

      {/*
        The reply box exists only once a human owns the thread. Showing it
        beside a "Take over" button invited the operator to type into a
        conversation the bot was still driving — and since sending silently
        took over anyway, the two controls did the same thing by different
        routes. Taking over is now the explicit first step, so the UI states
        are distinct: bot-owned means read-only, human-owned means you reply.
      */}
      {ownership === "BOT" ? (
        // Only speak up when taking over would be a dead end. Standing the
        // bot down and THEN discovering you cannot reply is a trap worth
        // warning about before the click, not after.
        blockedReason && (
          <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            {blockedReason} Taking over would stand the bot down without
            letting you reply.
          </div>
        )
      ) : blockedReason ? (
        <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          {blockedReason}
        </div>
      ) : (
        <div className="space-y-2">
          {windowState === "HUMAN_AGENT" && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Outside Meta&apos;s 24-hour window. This sends as a human-agent
              reply, which Meta permits only for messages written by a
              person — not automated replies.
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={pending !== null}
            rows={3}
            placeholder="Write a reply…"
            className="w-full rounded-md border border-border bg-background p-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="flex items-center justify-end gap-2">
            {/*
              No confirm modal on Send, deliberately. The repo convention
              ("every create/update/pause/delete needs explicit confirmation")
              targets Meta object mutations that are hard to inspect before
              they fire. A chat message is different: the operator wrote the
              text and can see it on screen, so the Send button IS the
              deliberate act. A modal on every message would make the inbox
              unusable and would train people to click through confirmations,
              weakening the ones that actually matter.
            */}
            <button
              type="button"
              onClick={() => void send()}
              disabled={pending !== null || !text.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending === "send" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              Send
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <ConfirmModal
        open={confirmAction === "return_to_bot"}
        title="Return this thread to the bot?"
        body="The automation will resume replying to new comments and DMs on this thread, and any flag on it will be cleared."
        confirmLabel="Return to bot"
        loading={pending === "return_to_bot"}
        error={confirmError}
        onCancel={() => {
          setConfirmAction(null);
          setConfirmError(null);
        }}
        onConfirm={() => void runSimple("return_to_bot")}
      />
      <ConfirmModal
        open={confirmAction === "resolve"}
        title="Clear the flag on this conversation?"
        // The consequence differs entirely by ownership, and the dangerous
        // case is silent: clearing the flag on a human-owned thread takes it
        // out of the only queue that would have reminded you, while the bot
        // is still stood down — so nobody is answering and nothing says so.
        body={
          ownership === "HUMAN"
            ? "It leaves the Needs attention queue. The bot stays stood down on this conversation, so nothing will reply until you use Return to bot."
            : "It leaves the Needs attention queue. The bot carries on handling this conversation as normal."
        }
        confirmLabel="Clear flag"
        loading={pending === "resolve"}
        error={confirmError}
        onCancel={() => {
          setConfirmAction(null);
          setConfirmError(null);
        }}
        onConfirm={() => void runSimple("resolve")}
      />
    </div>
  );
}
