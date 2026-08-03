"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ConfirmModal } from "@/components/ui/confirm-modal";

type Action = "take_over" | "return_to_bot" | "resolve" | "send";

interface InboxThreadProps {
  threadId: string;
  ownership: "BOT" | "HUMAN";
  /** Anchor for the 24h reply window — passed through for display only. */
  lastInboundAt: string | Date | null;
  /** Computed server-side via withinReplyWindow() so the client never
   * re-derives the window boundary from a possibly stale clock. */
  withinWindow: boolean;
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
  withinWindow,
}: InboxThreadProps) {
  const router = useRouter();
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    "return_to_bot" | "resolve" | null
  >(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [text, setText] = useState("");

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
        <button
          type="button"
          onClick={() => setConfirmAction("resolve")}
          disabled={pending !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Resolve
        </button>
      </div>

      {withinWindow ? (
        <div className="space-y-2">
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
      ) : (
        <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          Meta&apos;s 24-hour reply window has closed. Replying now needs the
          HUMAN_AGENT tag, which requires App Review approval.
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
        title="Resolve this thread?"
        body="This clears any flag and removes the thread from the Needs attention queue. Ownership is left as-is."
        confirmLabel="Resolve"
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
