-- pgvector + Embedding table for the RAG foundation.
-- Supabase Postgres ships pgvector; we just need to enable it.
CREATE EXTENSION IF NOT EXISTS vector;

-- One row = one chunk of text + its 1536-d embedding.
-- See prisma/schema.prisma `model Embedding` for the contract.
CREATE TABLE "Embedding" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "vector" vector(1536) NOT NULL,
    "businessId" TEXT,
    "adAccountId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Embedding_pkey" PRIMARY KEY ("id")
);

-- Re-indexing the same source overwrites — idempotent upserts.
CREATE UNIQUE INDEX "Embedding_namespace_sourceType_sourceId_key"
    ON "Embedding"("namespace", "sourceType", "sourceId");

-- Tenant-scoped reads are the common path: filter, then sort by distance.
CREATE INDEX "Embedding_businessId_namespace_idx"
    ON "Embedding"("businessId", "namespace");
CREATE INDEX "Embedding_adAccountId_namespace_idx"
    ON "Embedding"("adAccountId", "namespace");

-- Approximate-nearest-neighbour index on the vector. HNSW is pgvector's
-- recommended index since v0.5: fast queries, slightly slower writes, good
-- recall. Cosine distance (<=>) matches OpenAI text-embedding-3-small.
CREATE INDEX "Embedding_vector_hnsw_idx"
    ON "Embedding"
    USING hnsw ("vector" vector_cosine_ops);

-- Cascading deletes — when a business or account is removed, its embeddings
-- vanish too. Same multi-tenant safety story as the rest of the schema.
ALTER TABLE "Embedding"
    ADD CONSTRAINT "Embedding_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "MetaBusiness"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Embedding"
    ADD CONSTRAINT "Embedding_adAccountId_fkey"
    FOREIGN KEY ("adAccountId") REFERENCES "MetaAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
