# Meta Marketing Automation Tool

Internal agency tool for managing client Meta (Facebook/Instagram) ad accounts from a single interface.

## Before you do anything

1. **Read `PROJECT.md`.** Every Claude session should start by reading this file. It contains architecture rules, conventions, and the current phase.
2. **Don't skip the abstraction layer.** Meta API calls only happen in `src/lib/meta/`. If you find yourself importing the Meta SDK anywhere else, stop.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Start local Postgres (requires Docker Desktop running)
docker compose up -d

# 3. Set up environment variables
cp .env.example .env.local
# Then in .env.local:
#  - Generate ENCRYPTION_KEY:
#    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
#  - Optionally paste a Meta access token into META_TEST_TOKEN for dev shortcuts

# 4. Run migrations
npx prisma migrate dev

# 5. Run dev server
npm run dev
```

Open http://localhost:3000 — redirects to `/dashboard/accounts`.

## Phases

- **Phase 0 — Mockups & scaffold** ✅ done. Full UI shell with mock data.
- **Phase 0.5 — Discovery** (in progress). Paste a token, see what BMs / ad accounts it can access, pick what to sync. No real syncing yet.
- **Phase 1 — Sync.** Background jobs to mirror campaigns / ad sets / ads / insights locally with daily cron + 7-day re-pull.

See `PROJECT.md` for the architecture rules and the current data model.

## Working with Claude

When asking Claude to add a feature, give it context like:

> "Following the patterns in PROJECT.md, add a route at /dashboard/accounts/[id]/insights that shows the last 7 days of spend and impressions for an ad account. Use the abstraction in src/lib/meta/. Don't fetch directly from components."

Don't say: "build me an insights page." Claude will invent its own architecture and you'll regret it.
