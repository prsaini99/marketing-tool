"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Loader2, Copy } from "lucide-react";

interface SetupStatus {
  professional: boolean;
  pageLinked: boolean;
  platform?: string;
  tokenValid: boolean;
  scopes: { present: string[]; missing: string[] };
  webhook: { subscribed: boolean; fields: string[]; subscribedAt: string | null };
  env: {
    appSecretSet: boolean;
    verifyTokenSet: boolean;
    verifyToken: string | null;
    callbackUrl: string;
  };
  errors: { scopeError: string | null; webhookError: string | null };
}

function Row({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 text-red-500" />
      )}
      <div>
        <div>{label}</div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}

export function SetupChecklist({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/automation/accounts/${accountId}/setup-status`);
    const data = await res.json();
    if (!res.ok) setLoadError(data.error ?? "Failed to load status");
    else setStatus(data as SetupStatus);
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  async function subscribe() {
    setSubscribing(true);
    setSubscribeError(null);
    const res = await fetch(`/api/automation/accounts/${accountId}/subscribe`, {
      method: "POST",
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) setSubscribeError(data.error ?? "Subscribe failed");
    setSubscribing(false);
    await load();
    router.refresh();
  }

  if (loadError) return <div className="text-sm text-red-600">{loadError}</div>;
  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking Meta…
      </div>
    );
  }

  const ready =
    status.tokenValid && status.scopes.missing.length === 0 && !status.webhook.subscribed;

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <Row
          ok={status.professional}
          label={
            status.platform === "FACEBOOK"
              ? "Facebook Page access"
              : "Professional Instagram account"
          }
        />
        {status.platform !== "FACEBOOK" && (
          <Row ok={status.pageLinked} label="Linked Facebook Page" />
        )}
        <Row
          ok={status.tokenValid}
          label="Token valid"
          detail={status.errors.scopeError ?? undefined}
        />
        <Row
          ok={status.scopes.missing.length === 0}
          label="Required scopes"
          detail={
            status.scopes.missing.length > 0
              ? `Missing: ${status.scopes.missing.join(", ")}. Regenerate the system-user token in Business Manager with these checked.`
              : "All present"
          }
        />
        <Row
          ok={status.env.appSecretSet && status.env.verifyTokenSet}
          label="Server env vars (META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN)"
        />
        <Row
          ok={status.webhook.subscribed}
          // The field names differ per platform — a Page subscribes feed +
          // messages, an Instagram object subscribes comments + messages.
          // Naming the wrong pair here contradicts the setup instructions
          // rendered a few lines below and sends the operator looking for a
          // field that doesn't exist on their object.
          label={
            status.platform === "FACEBOOK"
              ? "Webhook subscribed (feed, messages)"
              : "Webhook subscribed (comments, messages)"
          }
          detail={status.errors.webhookError ?? undefined}
        />
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
        <div className="font-medium">Meta App Dashboard: one-time setup</div>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>
            Add the <b>Webhooks</b> product →{" "}
            {status.platform === "FACEBOOK" ? "Page object." : "Instagram object."}
          </li>
          <li>
            Callback URL:{" "}
            <code className="rounded bg-background px-1">{status.env.callbackUrl}</code>{" "}
            <Copy
              className="inline h-3.5 w-3.5 cursor-pointer"
              onClick={() => navigator.clipboard.writeText(status.env.callbackUrl)}
            />
          </li>
          <li>
            Verify token:{" "}
            <code className="rounded bg-background px-1">
              {status.env.verifyToken ?? "(set META_WEBHOOK_VERIFY_TOKEN in .env first)"}
            </code>
          </li>
          <li>
            Subscribe to fields{" "}
            {status.platform === "FACEBOOK"
              ? "feed and messages."
              : "comments and messages."}
          </li>
          <li>Switch the app to <b>Live mode</b>. Webhooks are not delivered in Dev mode.</li>
        </ol>
      </div>

      {!status.webhook.subscribed && (
        <div className="space-y-1">
          <button
            onClick={subscribe}
            disabled={!ready || subscribing}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {subscribing ? "Subscribing…" : "Subscribe webhooks"}
          </button>
          {!ready && (
            <div className="text-xs text-muted-foreground">
              Fix the red items above first.
            </div>
          )}
          {subscribeError && (
            <div className="text-xs text-red-600">{subscribeError}</div>
          )}
        </div>
      )}
    </div>
  );
}
