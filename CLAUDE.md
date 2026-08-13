# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

`PROJECT.md` holds the architecture rules and shipped-feature log; `README.md` covers setup. Both are largely accurate but have drifted — see **Doc drift** at the bottom before trusting a specific claim in them.

## Commands

```bash
npm run dev          # Next dev server
npm run build        # prisma generate && next build
npm run typecheck    # tsc --noEmit — run before claiming anything is done
npm run lint         # eslint
npm run cron-worker  # dev-only poller, hits /api/cron/tick every 60s
```

**There is no test suite** — no test runner, no test files, no `test` script. `typecheck` + `lint` are the only automated verification. Don't claim tests pass; don't invent a command to run them.

Database:

```bash
npx prisma migrate dev       # uses DIRECT_URL
npx prisma studio
node scripts/enable-rls.mjs  # re-run after adding any model (see RLS below)
```

The `db:*` scripts in `package.json` (`db:migrate`, `db:generate`, `db:reset`, `db:studio`) wrap `dotenv -e .env.local`, which is now correct: config lives in **`.env.local`** and there is no `.env`. `npm run cron-worker` wraps the same loader, because the tick endpoint requires `CRON_SECRET` and the worker has to read it.

## Environment

`.env.local` is what Next actually loads, and it is the only env file present. Two connection strings, both required:

- `DATABASE_URL` — Supabase **transaction** pooler, port 6543, with `?pgbouncer=true&connection_limit=1`. Used by Prisma Client. The Prisma **schema engine cannot run over this URL** — `prisma db execute`/`migrate` against it fails with "Error in Schema engine".
- `DIRECT_URL` — port 5432. Must use the **session pooler** hostname (`aws-1-*.pooler.supabase.com`), *not* `db.<ref>.supabase.co`. The latter is IPv6-only and unreachable from IPv4 networks.

`ENCRYPTION_KEY` must stay stable forever. It AES-256-GCM-encrypts Meta tokens at rest. If it changes, every stored token becomes undecryptable and **every Meta call fails with the Node crypto error `Unsupported state or unable to authenticate data`** — which reads like a Meta auth failure but is a local key mismatch. Recovery is re-pasting the token, not fixing Meta. Same stability rule for `SESSION_SECRET` (rotating logs everyone out).

Other env vars the code reads: `OPENAI_API_KEY` (required by the whole AI/RAG layer; prod logs a boot error if missing), `OPENAI_IMAGE_MODEL` (optional override for ad-image generation, default `gpt-image-1.5`), `CRON_SECRET` (**required in any deployment** — `/api/cron/*` is exempt from the session middleware, so this bearer token is the only thing guarding endpoints that sync from Meta, send email, spend OpenAI credits and execute budget rules. `requireCronAuth` in `src/lib/cron-auth.ts` fails closed: with no secret set, every cron request 401s. Vercel Cron sends the header automatically once the variable exists), `META_TEST_TOKEN` (optional dev shortcut).

- `META_APP_SECRET` — Meta app secret. Verifies `X-Hub-Signature-256` on every webhook POST to `/api/webhooks/meta`; without it the endpoint 500s by design.
- `META_WEBHOOK_VERIFY_TOKEN` — random string you paste into the App Dashboard webhook config; the GET handshake compares it.

## Architecture

Next.js 15 App Router + React 19 + Prisma 5 + Supabase Postgres. The layering is strict and load-bearing:

```
route handler / server component
  → src/server/services/<domain>/     ← business logic, audit logging, DB writes
    → src/lib/meta/client.ts          ← the ONLY module that calls Meta
```

**Never call Meta outside `src/lib/meta/`.** Meta deprecates API versions quarterly; the version is pinned in one place (`META_API_VERSION`, currently `v23.0`). Components and route handlers must not import Meta directly.

The data model mirrors Meta's object graph and the folder layout follows it: Business Manager → Ad Account → Campaign → Ad Set → Ad. Don't invent parallel abstractions.

### Local mirror, not live fetch

Meta data is mirrored into Postgres and read from there. Sync services (`src/server/services/sync/`) upsert by Meta id and are idempotent. Cascade runs `Connection → MetaBusiness → MetaAdAccount → everything` — deleting a Connection destroys all campaigns, ads, insights, embeddings, and audits under it. `DELETE /api/connections` does exactly this to every row; treat it as genuinely destructive.

To rotate a token **without** data loss, re-paste it: `createConnectionFromToken` upserts on the unique `tokenOwnerFbId`, so the same FB user takes the `update` branch and children stay attached. A *different* owner creates a second Connection and orphans the existing tree.

### Scheduled vs manual syncs

Ten sync services exist, but `ScheduleKind` (`src/lib/schedule.ts`) is only `campaigns | adsets | ads | insights`. Those four are the only ones the cron tick can run. **`creatives`, `images`, `videos`, `audiences`, `conversions`, and `account-detail` are manual-trigger only** and will never refresh on their own.

Adding a schedulable kind means touching `ScheduleKind`, `SCHEDULE_KINDS`, `CALLS_PER_RUN`, and the `runByKind` switch in `src/app/api/cron/tick/route.ts`.

### Asset URLs die, so the bytes are stored

**Do not trust any `*.fbcdn.net` URL in the database.** An earlier version of this file said they were signed and expired in roughly four days with a `403 URL signature expired`. That is wrong in both the timing and the failure mode, and believing it sends you looking in the wrong place.

What actually happens: Meta serves assets from `fna.fbcdn.net` edge appliances hosted inside ISP networks, and rotates which one you get. When an appliance is retired its hostname is removed from **global DNS**, so the browser gets a failed lookup rather than an HTTP error. Measured on `act_848772841278761`: URLs synced one day had no A record from Cloudflare, Google or Quad9 the next. Lifetime is about a day, not four.

Two consequences. Proxying cannot work, because a proxy replays the same dead hostname. And re-syncing does not "fix" a blank thumbnail so much as buy another day.

So the bytes are captured instead, in `src/server/services/sync/capture-assets.ts`, which runs at the end of the images, videos and creatives syncs. That is the one moment the URL is reliably live. Storage is Supabase (`src/lib/storage/assets.ts`), bucket `meta-assets`, **private**, content-addressed paths, served through `/api/media/*` which inherits the session check middleware applies to `/api/*`. Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; without them capture is skipped and the UI falls back to Meta's URLs, i.e. the old broken behaviour.

Render assets via `mediaUrl()` (`src/lib/media-url.ts`), never a raw `url` or `thumbnailUrl` column. It prefers `storagePath` and falls back to Meta.

`storedAt` and `storeAttemptedAt` are separate columns on purpose: that pair is what lets a sync retry only the assets that failed rather than re-downloading the library every run.

**Videos: only some have a file.** `AdVideo.sourceUrl` is populated only for videos uploaded to the ad account. Page-owned videos (boosted posts, reels) have no downloadable file on Meta at all, so they get a stored poster and no player, and they can never be transcribed. On the reference account that is 13 of 37. A still frame in the video library is not a sync failure.

### Incremental syncs, and why a full pull still runs

`campaigns`, `adsets` and `ads` filter on Meta's `updated_time` since the last successful sync, so a routine pull on a quiet account returns nothing. `decideSyncMode` (`src/server/services/sync/watermark.ts`) owns the policy.

**An `updated_time` filter can never report a deletion.** A deleted object simply stops appearing in the list, so an incremental-only mirror silently accumulates campaigns that no longer exist on Meta, and the stale rows look completely normal. A full unfiltered pull is therefore forced every `FULL_SYNC_INTERVAL_MS` (24h), and `SyncLog.fullPull` records which runs were unfiltered. That interval is the longest a deleted object can survive in the dashboard. Pass `{ forceFull: true }` to reconcile on demand.

The watermark is rewound 10 minutes before use (`INCREMENTAL_REWIND_MS`) because Meta's clock skews against ours; re-fetching a few unchanged rows is free since every write is an idempotent upsert.

### Instagram + Facebook Page automation (webhook-driven, not mirrored)

Comment/DM automation runs on Meta webhooks, NOT the cron mirror: `POST /api/webhooks/meta` (public route — exempted in `src/middleware.ts` alongside cron; auth is HMAC signature, not session) dedupes via unique `AutomationEvent.eventId`, 200s immediately, and processes in `after()`. The engine lives in `src/server/services/automation/` (pure `match`/`render`/`decide` + DB-touching `orchestrate`); Meta sends go through `src/lib/meta/messaging.ts` only, for both Instagram professional accounts and Facebook Pages. Meta windows enforced in `decide.ts`: comment→DM is ONE message within 7 days of the comment; thread DMs within 24h of the user's last inbound message. `/api/automation/dry-run` runs the engine with all side effects stubbed — use it to verify rule behavior without spamming real users. The Meta app must also be switched to **Live mode** in the App Dashboard, or webhooks are never delivered at all — no error, just silence.

`orchestrateEvent`'s dry-run safety is structural, not a caller convention: whenever `opts.persist` is `false`, it defaults `sender` to a hardcoded no-op (`NOOP_SENDER`) unless the caller injects one, so a dry run can never reach Meta even if a caller forgets to pass a recording sender. Separately, the engine refuses to send a blank message: any action whose rendered text is empty is skipped with `skipReason: "empty_render"`, enforced in `decide.ts` for all three template paths (`plannedFromRender`) and again as a backstop in `orchestrate.ts`, which also catches an AI reply that comes back empty.

`ai-guards.ts`'s `isReplySafe` output filter is stricter than "URLs and `$` prices": it also catches scheme-less links (`wa.me/123`, `bestdealz.com`) and word-first currency (`Rs 500`, `INR 2000`). Price checking is exact set membership over prices extracted from the profile corpus, deliberately not substring matching — substring matching let unrelated adjacent numbers fuse into a fabricated price.

The automation setup panel calls `/debug_token` and writes the result onto `Connection.scopes` (`src/app/api/automation/accounts/[id]/setup-status/route.ts`) — this fills a real pre-existing TODO in `src/server/services/connections/discover.ts`, where new connections used to persist `scopes: []` unconditionally.

### Cron topology

`vercel.json` schedules only two crons: `/api/cron/reindex/ad-copy` (02:00 UTC) and `/api/cron/alerts/daily` (02:30 UTC). **`/api/cron/tick` — the endpoint that runs all scheduled syncs — has no production trigger**: in dev `npm run cron-worker` polls it; in prod nothing does (the route comment says "prod TBD"). Scheduled syncs silently don't run in production until a Vercel Cron entry or external poller is added.

### The insights window loses history if you let it

`sync-insights.ts` pulls a rolling `WINDOW_DAYS` (90). Anything older than that **on the day of the first sync** is never collected, and every later run moves the window further past it. On `act_848772841278761` the first sync ran mid-May, so our history began 14 February while Meta's delivery began 12 January: 14,276.15 of real spend across 16 campaigns, rendered as a confident zero on every screen.

Nothing looks broken when this happens. The sync logs success, the arithmetic is internally consistent, and a rolling window cannot report data it never asked for. `syncInsightsForAccount` takes an optional `{ since, until }` for backfilling; Meta retains insights for roughly 37 months.

**Reconcile against Meta rather than trusting the mirror.** `GET /act_X/insights?date_preset=maximum` gives the account lifetime total; compare it to the sum of `InsightsSnapshot`. Any gap is history that was never captured.

### Writes: audit first, then Meta

Every mutating service writes an `AuditLog` row **before** the Meta call, with `after: { ..., _pending: true }`, then stamps the outcome (`_failed` / `_error`) after. A failed Meta call still leaves a trace. Follow this in any new write path — `src/server/services/campaigns/bulk-status.ts` is the canonical example. Bulk ops are sequential (capped at 100/request), never `Promise.all` fan-out, to stay inside rate limits.

### Meta error handling

`readMetaError` in `client.ts` pulls `error_user_title` / `error_user_msg`, which carry the real reason; Meta's `message` is usually just "Invalid parameter". Never replace it with a generic message.

Be very careful with `.catch(() => ({ data: [] }))` around Graph calls. That pattern previously turned an expired token into a cheerful "found 0 ad accounts under 0 businesses" and cost hours of misdiagnosis. `discoverWithToken` now lets `/me` throw (any valid token can call it, so failure means the token is dead) while keeping tolerant catches on `/me/businesses` and `/me/adaccounts` — those legitimately 403 for system-user vs BM-scoped tokens — and it throws with the captured reasons if discovery ends up empty *and* something errored.

### AI / RAG layer

Not covered in PROJECT.md. OpenAI is the sole vendor. Chat + embeddings funnel through `src/lib/llm/` (`chat.ts` exposes `DEFAULT_MODEL = "gpt-4o"`, overridable per call — `gpt-4o-mini` for cheap high-volume jobs — and `completeJson()` for schema-constrained structured output; `embeddings.ts` uses text-embedding-3-small, 1536-d). **Image generation is the exception**: `ai/generate-ad-image.ts` uses its own OpenAI client, defaulting to `gpt-image-1.5` (`OPENAI_IMAGE_MODEL` override) because it supports `input_fidelity: "high"` for product-faithful edits — `gpt-image-2` rejects that param with a 400. Features live in `src/server/services/ai/` (copy + image generation, account audit, anomaly detection, weekly reports, chat-with-data) with retrieval in `src/server/services/rag/`, including cross-account pattern transfer — performance-weighted winning ads from one account inform copy generation for another; auto-reindexed on creatives sync plus a nightly cron.

The shared `Embedding` table is pgvector. Prisma has no native vector type, so `vector` is `Unsupported("vector(1536)")` — **it can only be read/written via `$queryRaw` / `$executeRaw`**, never the typed client. Every row must set `businessId` or `adAccountId`, and every search must filter on one of them; that scoping is what prevents cross-tenant leakage.

### Auth

Login is rate limited to 10 attempts per IP per 15 minutes (`src/lib/rate-limit.ts`, in-memory so the counter is per serverless instance; a successful login clears the caller's counter). Security response headers (HSTS, `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy) are set for every route in `next.config.ts`. There is deliberately no full CSP yet: a real `script-src` needs per-request nonces threaded through the App Router bootstrap, and Clarity/GA4 will each need an explicit allowance when they land.

Single-user master-credential gate (`MASTER_EMAIL` / `MASTER_PASSWORD`) with an HMAC-signed session cookie. `src/middleware.ts` guards `/dashboard/:path*` plus all API routes **except `/api/auth/*` and `/api/cron/*`** — cron routes are publicly reachable and rely on their own optional `CRON_SECRET` bearer check. Multi-user is a future phase.

### RLS

Every public table has RLS **enabled with zero policies**, blocking PostgREST/Realtime/anon access entirely. Prisma connects as superuser and bypasses it. After adding a model, run `node scripts/enable-rls.mjs` or the new table is exposed.

## Conventions

- Build one vertical slice end-to-end before generalizing.
- Meta-faithful create forms (campaign, ad set, ad) ship a live JSON payload preview so the reviewer can audit what will hit Meta.
- Every create/update/pause/delete needs explicit user confirmation via `src/components/ui/confirm-modal.tsx`.
- `main` is protected and Vercel deploys only on merge into it. Work on `aditya/dev` or a branch off it, then PR.
- Vercel functions are pinned to `bom1` (Mumbai) to sit next to Supabase.

## Doc drift

`PROJECT.md` and `README.md` are stale in specific, misleading ways:

- **Rule #5 claims all Meta calls go through a retry wrapper. They don't.** `src/lib/meta/retry.ts` exports `withRetry` and *nothing imports it* — it is dead code. There is currently no retry or backoff on any Meta call. `rate-limit.ts` is likewise an explicit no-op stub.
- Both files say **"Create ad — not yet built"**. It shipped, along with creatives, images, videos, audiences, conversions, alerts, audits, playbook, reports, chat, and the whole AI/RAG stack. The folder listing in PROJECT.md predates all of it.
- README's setup instructions reference `.env.local`, which is now correct. Earlier revisions of this file claimed the repo used `.env`; it does not.
- PROJECT.md says "Production cron handled by Vercel Cron once deployed". `vercel.json` now schedules four crons including `/api/cron/tick` hourly, so the sync tick does have a prod trigger; the PROJECT.md wording predates it.

Update these when you touch the relevant area rather than adding another layer on top.
