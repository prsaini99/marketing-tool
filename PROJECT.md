# Meta Marketing Automation Tool — Project Context

> **Read this file at the start of every Claude session before making changes.**

## What this is

An internal multi-account Meta (Facebook/Instagram) ad management tool for our agency. We manage 10-20 client ad accounts and want a single unified interface, plus automation features the native Meta UI doesn't offer.

This is **NOT a public SaaS** (yet). Users are us and our team. Optimize for shipping speed and developer ergonomics over polish.

## Architecture rules — these are non-negotiable

### 1. Meta API access goes through ONE place
All Meta API calls happen in `src/lib/meta/`. UI components and route handlers NEVER call Meta directly. They call service functions in `src/server/services/` which call `src/lib/meta/`.

Why: Meta deprecates API versions quarterly. When (not if) Meta breaks something, we fix it in one place.

### 2. The hierarchy mirrors Meta's object model
Business Manager → Ad Account → Campaign → Ad Set → Ad. Our database tables, services, and UI routes follow this hierarchy. Don't invent new abstractions.

### 3. Every write operation has a confirmation step
Anything that creates, updates, pauses, or deletes on Meta requires explicit user confirmation. Especially budget changes — we've all heard the horror stories. Confirm modals live in `src/components/ui/confirm-modal.tsx` and every bulk op routes through one.

### 4. Every write operation is audit-logged BEFORE the Meta call
Bulk-status, bulk-budget, create-campaign, create-adset (and create-ad once it lands) all write an `AuditLog` row before firing Meta. The row is stamped with success/failure + Meta error message after. This way, even a failed Meta call leaves a trace. The audit log viewer at `/dashboard/audit-log` reads these rows.

### 5. Rate limits are real — assume every Meta call can fail
- All Meta calls go through a retry wrapper with exponential backoff (`src/lib/meta/retry.ts`)
- Bulk operations are sequential (cap of 100 per request) — not `Promise.all` loops
- Per-account rate-limit tracking is a no-op stub today (`src/lib/meta/rate-limit.ts`); add a real implementation when volume justifies it

### 6. Never log access tokens, even partially
Tokens are encrypted at rest in the DB (AES-256-GCM, key in `ENCRYPTION_KEY`) and only decrypted inside `src/lib/meta/credentials.ts`. Logs reference connection IDs, never values. `ENCRYPTION_KEY` MUST stay stable in production — rotating it orphans every stored token.

### 7. Meta error messages must surface the user-facing text
Meta wraps the real reason in `error_user_msg` / `error_user_title`; `message` is often just "Invalid parameter". `readMetaError` in `src/lib/meta/client.ts` extracts the most specific field — never swap that out for a generic message.

## Tech stack

- **Framework:** Next.js 15 (App Router) + TypeScript + React 19
- **UI:** Tailwind CSS v4, dense Linear/Stripe-flavored layout, single accent color
- **Database:** Supabase Postgres (region: South Asia / Mumbai). Local Docker is supported as a dev option but Supabase is the source of truth.
- **ORM:** Prisma 5 — pooled URL (`DATABASE_URL`, PgBouncer transaction mode) for app, direct URL (`DIRECT_URL`) for migrations
- **Auth:** Master-credential login backed by `.env` (`MASTER_EMAIL` / `MASTER_PASSWORD` / `SESSION_SECRET`). Single-user. Multi-user via Supabase Auth is a future phase. See `src/lib/auth.ts` + `src/middleware.ts`.
- **Charts:** Recharts
- **Meta SDK:** raw `fetch` against Graph API v23.0 (the SDK is installed but unused — too noisy for our call set)
- **Background jobs:** `scripts/cron-worker.mjs` polls `/api/cron/tick` every 60s in dev. Production cron handled by Vercel Cron once deployed.
- **Hosting:** Vercel (production). Function region pinned to Mumbai (`bom1`) to be co-located with Supabase.
- **Env management:** `.env.local` for dev; Vercel Project Settings → Environment Variables for prod
- **Row-Level Security:** RLS is **enabled on every public table** with **zero policies**, so PostgREST / Realtime / Edge anon access is blocked. Prisma (postgres superuser) bypasses RLS and reads everything. Re-enable after adding a new table via `scripts/enable-rls.mjs`.

## Folder structure

```
src/
  app/
    dashboard/            # Authenticated app routes (literal path, guarded by middleware)
      accounts/           # Account list + merged detail page (campaigns inline)
      campaigns/          # Flat cross-account view (search, bulk ops, CSV export, new campaign)
      adsets/             # Flat cross-account view (search, bulk ops)
      ads/                # Flat cross-account view (search, bulk ops, preview modal)
      insights/           # Cross-account performance dashboard
      audit-log/          # All write-ops history with filters + pagination
      settings/           # Connections + danger zone (disconnect / sign out)
      connect-business/   # Paste-token discovery flow
    login/                # Master-credential sign-in (functional)
    forgot-password/      # Mock — wired when multi-user auth lands
    api/
      auth/{login,logout} # Session cookie set/clear
      connect/discover    # Discovery endpoint
      connections/[id]    # Per-connection delete + bulk select
      campaigns/          # bulk-status, bulk-budget, create, export.csv
      adsets/             # bulk-status, bulk-budget, create
      ads/                # bulk-status, [id]/previews
      sync/[adAccountId]  # campaigns / adsets / ads / insights manual triggers
      cron/tick           # Schedule-driven sync loop entrypoint
      accounts/[id]       # schedules, schedules/[kind]
  components/
    layout/               # Sidebar, topbar, account switcher
    tables/               # Reusable data tables (drill-down + flat variants)
    campaigns/            # NewCampaignButton, CreateCampaignModal, BudgetEditModal
    adsets/               # NewAdSetButton, CreateAdSetModal, BudgetEditModal
    ads/                  # AdPreviewButton, AdPreviewModal
    insights/             # KpiCard, SpendChart, ClientSpendBar, TopCampaigns, DateRangeDropdown
    audit/                # FilterDropdown (target / action)
    sync/                 # SyncNowButton, SyncAllInsightsButton, SyncHistoryButton/Modal
    schedules/            # SchedulesButton + SchedulesModal
    connections/          # DisconnectButton / DisconnectAllButton
    auth/                 # SignOutButton
    ui/                   # search-bar, confirm-modal, empty-state
  lib/
    meta/                 # Meta API client (THE ONLY PLACE Meta is called)
      client.ts             # All GETs + POSTs (create, status, budget, previews)
      credentials.ts        # AES-GCM encrypt/decrypt + decrypted-token resolution
      ad-placements.ts      # Placement labels used by previews
      retry.ts              # Exponential-backoff wrapper
      rate-limit.ts         # No-op stub for now
      types.ts              # Normalized types returned by the client
    db/prisma.ts          # Prisma client singleton
    auth.ts               # Master-cred check + session cookie helpers
    audit.ts              # Action-code parsing + before→after diff for the viewer
    display.ts            # UI display types (Display*, FlatDisplay*) + label maps
    date-range.ts         # ?range= preset resolver (7d/30d/90d/all)
    schedule.ts           # Frequency presets + next-run computation
    active-business.ts    # Resolves "current client" from URL (?client= or path)
    utils.ts              # cn() helper
  server/
    services/
      connections/discover.ts    # Token → BMs/ad accounts upsert
      sync/{sync-campaigns,sync-adsets,sync-ads,sync-insights}.ts
      campaigns/{bulk-status,bulk-budget,create}.ts
      adsets/{bulk-status,bulk-budget,create}.ts
      ads/{bulk-status}.ts       # bulk-status only; create lands later
scripts/
  cron-worker.mjs        # Dev-only poller for /api/cron/tick
  enable-rls.mjs         # Enables RLS on every public table (run after adding a model)
```

## Database schema

Local mirror of Meta data, keyed by `Connection` (one per pasted token). See `prisma/schema.prisma` for the full source of truth.

Tables:

- `Connection` — one per pasted token. Encrypted token + scopes + status. Unique by `tokenOwnerFbId` so re-pasting the same token refreshes instead of duplicating.
- `MetaBusiness` — discovered via a connection (one connection can grant access to many).
- `MetaAdAccount` — discovered, with `selectedForSync` flag. Only selected accounts mirror campaigns/ad sets/ads/insights.
- `Campaign` / `AdSet` / `Ad` — mirrored locally. Upserted by Meta id on sync.
- `InsightsSnapshot` — daily metric rows keyed by `(adAccountId, date, level, entityId)`. Level = account/campaign/adset/ad.
- `SyncLog` — every sync attempt per account+kind. Status (success/running/failed) + error + duration.
- `SyncSchedule` — per-account, per-kind cron-style schedule. Tick loop reads `enabled = true AND nextRunAt <= now`.
- `AuditLog` — every Meta write the platform performs. Includes `_pending` / `_failed` / `_error` markers in the after-JSON.

### Key pivots from earlier plans

| Earlier plan | Current plan |
|---|---|
| OAuth per business | **Paste-token flow** — one token per `Connection`. |
| Local Docker Postgres in prod | **Supabase Postgres** (Mumbai) with RLS enabled. |
| Don't mirror Meta data — fetch on demand + Redis cache | **Mirror campaigns / ad sets / ads / insights** locally; daily cron + 7-day re-pull (Meta backfills attributions ~28 days). |
| Sync everything visible | **Per-account opt-in** via `selectedForSync` + per-kind `SyncSchedule`. |
| Auth TBD | **Master-credential login** in `.env` (single user). Multi-user Supabase Auth is future. |
| Storybook-style mock layer | **Mock data fully replaced** — every table reads real Prisma queries. |
| 3-dot row menu on Accounts | Removed — all account ops live in the account detail page header. |
| Account detail vs Campaigns page | **Merged** — clicking an account row shows account stats + campaigns table inline. |

## Working with Claude on this codebase

- Build one vertical slice end-to-end before generalizing.
- Never skip the abstraction layer "just this once" — every Meta call goes through `src/lib/meta/`.
- Always type-check before saying something is done (`npm run typecheck`). Lint should be green too.
- If you find yourself writing the same Meta API pattern in two places, extract it to `lib/meta/`.
- When adding a new feature, update this file with any new architectural decisions.
- Each Meta-faithful "create" form (campaign, adset, soon ad) ships a **live JSON payload preview** on the right so the senior can audit what's about to hit Meta.

## Git workflow

- **`main` is protected** — direct pushes are blocked. Vercel auto-deploys only on merge into `main`.
- Day-to-day work happens on **`aditya/dev`** (or a feature branch off it).
- To ship: push the branch, open a PR → `main`, senior reviews + merges, Vercel builds the merge commit.

## Current state — what's shipped

### Phase 0 — Mockups & scaffold ✅
Full UI shell with mock data: dashboard chrome, accounts → campaigns → ad sets → ads drill-down, insights cross-account view, flat campaigns with bulk-action affordance, settings, login + forgot password.

### Phase 0.5 — Discovery ✅
Paste-token flow: pick BMs/accounts to sync, encrypted storage, `Connection` model. All read-only.

### Phase 1 — Sync ✅
- Manual sync per kind (Sync now button)
- Per-account schedules with frequency presets (off / hourly / every 6h / daily / every 3d / weekly)
- Cron worker polls `/api/cron/tick` every 60s in dev
- Insights pulled at all 4 levels (account / campaign / adset / ad) over 90 days, idempotent upsert

### Phase 2 — Write operations ✅
- **Bulk ops** at campaign / ad set / ad levels: Pause / Activate / Archive + Edit budget (campaigns + ad sets only). All audit-logged.
- **Create campaign** with Meta-faithful field set: name, objective, special ad category, CBO toggle, budget, spend cap, status (defaults PAUSED).
- **Create ad set** with full targeting (country, age, gender), placements (automatic vs manual per surface), optimization goal + promoted_object (pixel / page / app — conditional on objective).
- **Create ad** — not yet built (next).

### Phase 2.5 — UX polish ✅
- **Merged account detail page** (was separate detail + campaigns drill-down).
- **Flat pages** for campaigns / ad sets / ads with: cross-account view, client switcher, date range, search (Meta-style, name only), bulk ops, spend / impressions / CTR columns.
- **Audit log viewer** at `/dashboard/audit-log` with target + action filters, date range, pagination.
- **Ad preview modal** — Meta iframe previews for one ad, single placement default + dropdown switch + "Show all placements" grid view. Lazy fetching, client-side cache, no iframe reloads on switch.
- **Schedules modal** on account detail (was a 3-dot menu item).
- **CSV export** of campaigns lives on `/dashboard/campaigns` (was on each account page).

### Phase 2.6 — Production hardening ✅
- **Master-credential auth** with HMAC-signed session cookie, middleware-guarded routes.
- **Supabase RLS** enabled on all tables with zero policies (defense in depth against anon-key leak).
- **Branch protection** on `main` with PR-only merges.
- **Vercel deployment** with Prisma generate in build step, Mumbai function region.

## Backlog (not yet built)

- **Create ad** — image upload + creative spec (link_data with image_hash). Most complex of the three create forms because of the file upload.
- **Carousel / video / collection** ad formats.
- **A/B test** setup at campaign creation.
- **Advanced bid strategies** (Cost cap, Bid cap, Min ROAS) at campaign + ad set level — currently hardcoded to LOWEST_COST_WITHOUT_CAP.
- **Multi-user auth + teams + RLS policies** scoping rows to a user/team.
- **Shareable client-approval links** for ad previews (no-login URLs).
- **Side-by-side ad comparison** (pick 2-4 ads, render side by side).
- **Inngest / production cron** for sync at scale (replace the dev poller).
- **Per-account rate-limit tracking** in a shared cache.
