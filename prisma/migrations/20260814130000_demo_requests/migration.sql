-- Inbound demo requests from the marketing site.
--
-- The only table written by an anonymous caller, hence the rate limiting and
-- honeypot on the route that fills it. Every text column is attacker-supplied
-- and must be rendered as text, never as HTML.
--
-- Hand-written rather than generated, for the same reason as the asset
-- storage migration: `prisma migrate diff` also wants to DROP INDEX
-- "Embedding_vector_hnsw_idx", the pgvector index built in raw SQL that
-- Prisma cannot see in the datamodel and therefore reads as drift.
CREATE TABLE "DemoRequest" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "email"        TEXT NOT NULL,
  "company"      TEXT,
  "monthlySpend" TEXT,
  "message"      TEXT,
  "source"       TEXT,
  "utmSource"    TEXT,
  "utmMedium"    TEXT,
  "utmCampaign"  TEXT,
  "referrer"     TEXT,
  "status"       TEXT NOT NULL DEFAULT 'NEW',
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DemoRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DemoRequest_status_createdAt_idx" ON "DemoRequest" ("status", "createdAt");
CREATE INDEX "DemoRequest_createdAt_idx" ON "DemoRequest" ("createdAt");
