import Link from "next/link";
import {
  AlertTriangle,
  LogOut,
  Plug,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { ConnectionStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { prisma } from "@/lib/db/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import { DisconnectButton } from "@/components/connections/disconnect-button";
import { DisconnectAllButton } from "@/components/connections/disconnect-all-button";
import { SignOutButton } from "@/components/auth/sign-out-button";

function ConnectionStatusPill({ status }: { status: ConnectionStatus }) {
  const styles: Record<ConnectionStatus, string> = {
    ACTIVE: "bg-green-50 text-green-700",
    TOKEN_EXPIRING: "bg-amber-50 text-amber-700",
    REVOKED: "bg-zinc-100 text-zinc-600",
    ERROR: "bg-red-50 text-red-700",
  };
  const dot: Record<ConnectionStatus, string> = {
    ACTIVE: "bg-green-500",
    TOKEN_EXPIRING: "bg-amber-500",
    REVOKED: "bg-zinc-400",
    ERROR: "bg-red-500",
  };
  const label: Record<ConnectionStatus, string> = {
    ACTIVE: "Active",
    TOKEN_EXPIRING: "Token expiring",
    REVOKED: "Revoked",
    ERROR: "Error",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        styles[status],
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dot[status])} />
      {label[status]}
    </span>
  );
}

function formatDate(d: Date | null) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function formatRelative(d: Date | null): string {
  if (!d) return "never";
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)} days ago`;
  return formatDate(d);
}

export default async function SettingsPage() {
  const connections = await prisma.connection.findMany({
    include: {
      businesses: {
        include: {
          adAccounts: {
            select: { id: true, selectedForSync: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-3xl space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-sm text-muted">
          Manage your Meta connections. Team management arrives with user auth in a future phase.
        </p>
      </header>

      {/* Connections */}
      <section>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              Connections
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Meta access tokens you&apos;ve added, with the businesses each one can see.
            </p>
          </div>
          <Link
            href="/dashboard/connect-business"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium hover:bg-surface-2 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Connect a Meta business
          </Link>
        </div>

        {connections.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={Plug}
              title="No connections yet"
              description="Paste a Meta access token to discover what ad accounts it can manage."
              action={{
                label: "Connect a Meta business",
                href: "/dashboard/connect-business",
              }}
            />
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background">
            <ul className="divide-y divide-border">
              {connections.map((c) => {
                const totalAccounts = c.businesses.reduce(
                  (n, b) => n + b.adAccounts.length,
                  0,
                );
                const selectedAccounts = c.businesses.reduce(
                  (n, b) =>
                    n + b.adAccounts.filter((a) => a.selectedForSync).length,
                  0,
                );
                return (
                  <li
                    key={c.id}
                    className="px-4 py-3 hover:bg-surface transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-surface-2">
                        <Plug className="h-3.5 w-3.5 text-muted" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <p className="truncate text-sm font-medium">
                            {c.label || c.tokenOwnerName || "Untitled connection"}
                          </p>
                          <ConnectionStatusPill status={c.status} />
                        </div>
                        <p className="truncate text-xs text-subtle">
                          Connected {formatDate(c.createdAt)} · Last discovered{" "}
                          {formatRelative(c.lastDiscoveredAt)} ·{" "}
                          {c.businesses.length}{" "}
                          {c.businesses.length === 1 ? "business" : "businesses"} ·{" "}
                          {selectedAccounts}/{totalAccounts} ad accounts selected
                        </p>
                      </div>
                      {c.status === "TOKEN_EXPIRING" ? (
                        <Link
                          href="/dashboard/connect-business"
                          className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 transition-colors"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Reconnect
                        </Link>
                      ) : (
                        <DisconnectButton
                          connectionId={c.id}
                          connectionLabel={
                            c.label || c.tokenOwnerName || "this connection"
                          }
                        />
                      )}
                    </div>
                    {c.businesses.length > 0 && (
                      <ul className="mt-2 ml-11 space-y-0.5">
                        {c.businesses.map((b) => {
                          const sel = b.adAccounts.filter(
                            (a) => a.selectedForSync,
                          ).length;
                          return (
                            <li
                              key={b.id}
                              className="flex items-baseline justify-between text-xs"
                            >
                              <span className="text-muted">{b.name}</span>
                              <span className="text-subtle tabular-nums">
                                {sel}/{b.adAccounts.length} selected
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* Danger zone */}
      <section>
        <h2 className="text-sm font-semibold tracking-tight text-danger">
          Danger zone
        </h2>
        <p className="mt-0.5 text-xs text-muted">
          Irreversible actions. Be careful.
        </p>
        <div className="mt-3 space-y-3 rounded-lg border border-red-200 bg-red-50/30 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-danger" />
                <p className="text-sm font-medium">
                  Disconnect all Meta businesses
                </p>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Revokes all access tokens. You&apos;ll need to reconnect each
                business to resume management.
              </p>
            </div>
            <DisconnectAllButton connectionCount={connections.length} />
          </div>
          <div className="flex items-start justify-between gap-4 border-t border-red-200 pt-3">
            <div>
              <div className="flex items-center gap-1.5">
                <LogOut className="h-3.5 w-3.5 text-danger" />
                <p className="text-sm font-medium">Sign out of this device</p>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Clears the session cookie. You&apos;ll need to sign in again
                with the master credentials to come back.
              </p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </section>
    </div>
  );
}
