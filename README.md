# Meta Marketing Automation Tool

Internal agency tool for managing client Meta (Facebook/Instagram) ad accounts from a single interface — sync, bulk operations, audit log, and Meta-faithful campaign + ad-set creation.

## Before you do anything

1. **Read `PROJECT.md`.** Every Claude session should start by reading this file. It contains architecture rules, conventions, tech stack, folder layout, and the current state of what's shipped.
2. **Don't skip the abstraction layer.** Meta API calls only happen in `src/lib/meta/`. If you find yourself importing Meta anywhere else, stop.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env.local
# Then fill in .env.local:
#  - DATABASE_URL    — Supabase Transaction pooler URL (port 6543).
#                      Append ?pgbouncer=true&connection_limit=1
#  - DIRECT_URL      — Supabase Session pooler URL (port 5432) on the
#                      pooler hostname. Used by Prisma for migrations.
#  - ENCRYPTION_KEY  — Generate ONCE, then keep stable forever:
#                      node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
#  - MASTER_EMAIL    — Login email
#  - MASTER_PASSWORD — Login password
#  - SESSION_SECRET  — Same generator as ENCRYPTION_KEY. Rotating logs everyone out.
#  - META_TEST_TOKEN — (optional) Meta token for dev shortcuts

# 3. Push the Prisma schema to your DB
npx dotenv -e .env.local -- npx prisma db push

# 4. Enable Row-Level Security on every table (defense in depth)
npx dotenv -e .env.local -- node scripts/enable-rls.mjs

# 5. Run the dev server
npm run dev

# 6. (optional) Run the cron worker for auto-sync schedules
npm run cron-worker
```

Open http://localhost:3000 — you'll be redirected to `/login`. Sign in with `MASTER_EMAIL` + `MASTER_PASSWORD`, then you'll land at `/dashboard/accounts`.

### Local Postgres (alternative)

A `docker-compose.yml` is provided for running Postgres 16 locally instead of Supabase. Point `DATABASE_URL` at `postgresql://postgres:postgres@localhost:5432/meta_marketing` and skip the RLS step. Supabase is the production target.

## What's in the box

| Surface | What it does |
|---|---|
| `/login` | Master-credential gate. Sets a signed session cookie. |
| `/dashboard/accounts` | List of selected ad accounts. Click → merged detail page (stats + campaigns table). |
| `/dashboard/accounts/[id]` | Single account: KPIs, campaigns table inline, Sync now / Sync history / Schedules / New campaign. |
| `/dashboard/campaigns` | Flat cross-account campaigns with search, date range, bulk ops, CSV export, New campaign. |
| `/dashboard/adsets` | Flat cross-account ad sets with search, bulk ops, edit budget. |
| `/dashboard/ads` | Flat cross-account ads with search, bulk status, **multi-placement preview modal**. |
| `/dashboard/insights` | Cross-account spend chart + leaderboards. |
| `/dashboard/audit-log` | Every write op the platform has performed (status changes, budget edits, creations). Filterable. |
| `/dashboard/settings` | Connections + danger zone (disconnect / sign out). |
| `/dashboard/connect-business` | Paste a Meta access token → discover BMs + ad accounts → pick which to sync. |

## Git workflow

- **`main` is protected** — direct pushes are blocked. Vercel auto-deploys only on merge into `main`.
- Day-to-day work happens on `aditya/dev` (or a feature branch off it).
- To ship: push the branch → open a PR into `main` → senior reviews + merges → Vercel builds the merge commit.

## Deploying to Vercel

1. Import the GitHub repo into Vercel.
2. **Set the function region** to `bom1` (Mumbai) so it's co-located with the Supabase DB. Project Settings → Functions → Region.
3. Add the same env vars from `.env.local` under Project Settings → Environment Variables.
4. The build script (`prisma generate && next build`) generates the Prisma client automatically. The `postinstall` hook handles it for cached installs.

## Working with Claude

Give Claude context, not vibes. Bad:

> "build me an insights page."

Good:

> "Following the patterns in PROJECT.md, add a route at `/dashboard/accounts/[id]/insights` that shows the last 7 days of spend and impressions for an ad account. Use the abstraction in `src/lib/meta/`. Don't fetch directly from components."

Without context Claude invents its own architecture and you regret it.

## Current state

See **Current state** in `PROJECT.md` — that section is the source of truth for what's shipped vs backlog. As of the latest commit: Phases 0 / 0.5 / 1 / 2 / 2.5 / 2.6 are done. **Create ad** (image-upload creative flow) is the next item on deck.
