"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmModal } from "@/components/ui/confirm-modal";

export function BotToggle({
  accountId,
  username,
  botEnabled,
}: {
  accountId: string;
  username: string;
  botEnabled: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/automation/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botEnabled: !botEnabled }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Update failed");
      setLoading(false);
      return;
    }
    setLoading(false);
    setConfirming(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className={`rounded-full px-3 py-1 text-xs font-semibold ${
          botEnabled
            ? "bg-green-100 text-green-800"
            : "bg-surface text-muted-foreground border border-border"
        }`}
      >
        {botEnabled ? "Bot ON" : "Bot OFF"}
      </button>
      <ConfirmModal
        open={confirming}
        title={botEnabled ? `Disable bot for @${username}?` : `Enable bot for @${username}?`}
        body={
          botEnabled
            ? "The bot will stop replying to new comments and DMs immediately. Existing rules are kept."
            : "The bot will start replying to comments and DMs per your rules, with no human review. Make sure your rules and bot profile are ready."
        }
        confirmLabel={botEnabled ? "Disable" : "Enable"}
        variant={botEnabled ? "danger" : "neutral"}
        loading={loading}
        error={error}
        onCancel={() => setConfirming(false)}
        onConfirm={apply}
      />
    </>
  );
}
