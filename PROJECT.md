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
Anything that creates, updates, pauses, or deletes on Meta requires explicit user confirmation. Especially budget changes. We've all heard the horror stories.

### 4. Rate limits are real — assume every Meta call can fail
- All Meta calls go through a retry wrapper with exponential backoff (`src/lib/meta/retry.ts`)
- Bulk operations queue through a background job runner, not `Promise.all` loops
- Per-account rate-limit tracking will live in a shared cache once volume justifies it

Background job runner + cache are TBD — we use no-op stubs in Phase 0.5 and adopt real implementations when sync jobs land in Phase 1.

### 5. Never log access tokens, even partially
Tokens are encrypted at rest in the DB and only decrypted inside `src/lib/meta/credentials.ts`. Logs reference token IDs, never values.

## Tech stack

- **Framework:** Next.js 15 (App Router) + TypeScript
- **UI:** Tailwind CSS v4 + shadcn-style design tokens (Linear/Stripe-flavored dense layout)
- **Database:** Postgres 16 via local Docker for dev (`docker compose up -d`). Prod TBD.
- **ORM:** Prisma
- **Auth:** TBD — Phase 0.5 has no user auth (single-user local dev). Will adopt Supabase Auth or similar when we need multi-user access.
- **Charts:** Recharts
- **Meta SDK:** facebook-nodejs-business-sdk
- **Background jobs:** TBD (Inngest is a candidate when Phase 1 sync jobs land)
- **Hosting:** TBD (Vercel is a candidate for the Next.js side)
- **Env management:** `.env.local` for dev, hosted env for prod

## Folder structure

```
src/
  app/
    dashboard/            # Authenticated app routes (literal path, not a route group)
      accounts/           # Ad accounts list + drill-downs
      campaigns/          # Flat cross-account view
      insights/           # Cross-account performance dashboard
      settings/           # Workspace / team / connected businesses
    login/                # Sign-in
    forgot-password/      # Password reset request
    api/                  # API route handlers
  components/
    layout/               # Sidebar, topbar, switchers
    tables/               # Reusable data tables (accounts, campaigns, ad sets, etc.)
    insights/             # KPI card, chart, leaderboards
    ui/                   # Generic primitives (empty state, etc.)
  lib/
    meta/                 # Meta API client (THE ONLY PLACE Meta SDK is imported)
    db/                   # Prisma client + helpers
    mock/                 # Mock data for Phase 0 UI scaffolding
    active-business.ts    # Resolves "current client" from URL (?client= or path)
    utils.ts              # cn() helper
  server/
    services/             # Business logic (campaigns, accounts, insights)
    jobs/                 # Background job definitions (Phase 1+)
```

## Database schema

The local mirror of Meta data is keyed by `Connection` — one per pasted token. Below is the target shape; we build incrementally:

- Phase 0.5 covers `Connection` + `MetaBusiness` + `MetaAdAccount` (with `selectedForSync` flag).
- Phase 1 adds `Campaign` / `AdSet` / `Ad` / `InsightsSnapshot` (mirrored from Meta).

Tables:

- `user` — team members (Phase 0.5: no auth yet)
- `connection` — one per pasted token. Encrypted token + scopes + status
- `meta_business` — discovered via a connection (one connection can give many)
- `meta_ad_account` — discovered, with `selected_for_sync` flag
- `campaign` / `ad_set` / `ad` — MIRRORED locally (Phase 1)
- `insights_snapshot` — daily metric rows, keyed by `(date, level, entity_id)` (Phase 1)
- `sync_log` — when we last synced each ad account, by kind
- `audit_log` — every write operation we perform on Meta

### Key pivots from earlier plan

| Earlier plan | Current plan |
|---|---|
| OAuth per business | **Paste-token flow** — one token per `Connection` |
| Supabase Postgres | **Local Docker Postgres** for dev (prod TBD) |
| Don't mirror Meta data — fetch on demand + Redis cache | **Mirror campaigns/ad sets/ads/insights** locally; daily cron + 7-day re-pull (Meta backfills attributions for ~28 days) |
| Sync everything visible | **User picks** which BMs / ad accounts to sync per Connection |

## Working with Claude on this codebase

- Build one vertical slice end-to-end before generalizing
- Never let me skip the abstraction layer "just this once"
- Always type-check before saying something is done
- If you find yourself writing the same Meta API pattern in two places, extract it to `lib/meta/`
- When adding a new feature, update this file with any new architectural decisions

## Current phase

**Phase 0 — Mockups & scaffold** ✅ done. Full UI shell with mock data — dashboard chrome, accounts → campaigns → ad sets → ads drill-down, insights cross-account view, flat campaigns with bulk-action affordance, settings, login + forgot password.

**Phase 0.5 — Discovery** (in progress). Real backend, read-only:
1. User pastes a Meta access token into a textarea
2. We call Meta API to enumerate BMs + ad accounts the token can see
3. We store the `Connection` (encrypted) + discovered entities
4. User picks which BMs / ad accounts to sync — we store the choice
5. (No actual sync of campaigns/ads/insights yet — that's Phase 1)

**Phase 1 — Sync.** Background jobs to backfill historical data (90/365 days) and run a daily cron with 7-day re-pull for attribution updates.
