/**
 * RAG service — the single read/write path for the Embedding table.
 *
 * Every "AI feature" on the platform funnels through three operations:
 *   • indexText  — embed a chunk and upsert it (idempotent re-indexing).
 *   • search     — embed a query and pull the top-K nearest neighbours,
 *                  ALWAYS scoped to a businessId or adAccountId.
 *   • deleteByNamespace — bulk drop a corpus (e.g. when re-building an
 *                  account's brand-doc index from scratch).
 *
 * Why the indirection: pgvector's column is `Unsupported("vector(1536)")`
 * in Prisma, so the vector field has to be read/written via raw SQL.
 * Keeping all of that here means feature code stays pure Prisma + plain
 * strings, and we have one place to swap the embedding model later.
 *
 * Tenant safety: search() requires at least one of businessId / adAccountId.
 * No tool on the platform should ever be able to read another client's
 * embeddings — the type signature enforces it, and the SQL filter encodes
 * it. If we ever add a global corpus (e.g. industry benchmarks), it goes
 * through its own function, not this one.
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  embedText,
} from "@/lib/llm/embeddings";

export interface IndexInput {
  /** Partition of the index — e.g. "ads", "brand_docs", "audit_findings". */
  namespace: string;
  /** Origin table or source type — e.g. "Ad", "AdCreative", "BrandDoc". */
  sourceType: string;
  /** Origin row id (or any stable string for non-DB sources). */
  sourceId: string;
  /** Raw text to embed. Returned verbatim on search hits. */
  content: string;
  /** Tenant scope — at least one of these MUST be set for tenant corpora. */
  businessId?: string | null;
  adAccountId?: string | null;
  /** Free-form structured metadata returned with hits (e.g. ROAS, date). */
  metadata?: Record<string, unknown>;
}

/**
 * Embed `content` and upsert the row. Re-indexing the same source overwrites
 * (the (namespace, sourceType, sourceId) tuple is unique), so this is safe
 * to call repeatedly as data changes.
 *
 * One atomic raw INSERT … ON CONFLICT — pgvector's vector type is
 * Unsupported in Prisma, so the whole row goes through raw SQL. RETURNING
 * gives us the row's actual id (existing on conflict, new on insert).
 */
export async function indexText(input: IndexInput): Promise<{ id: string }> {
  const vec = await embedText(input.content);
  if (vec.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `embedding dimension mismatch — got ${vec.length}, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }

  const vecLiteral = `[${vec.join(",")}]`;
  // Stamp the model so we can detect rows that need re-embedding if we ever
  // swap providers / dimensions.
  const metadataJson = JSON.stringify({
    ...(input.metadata ?? {}),
    model: EMBEDDING_MODEL,
  });
  // Used only on INSERT — on conflict the existing id is preserved.
  const newId = randomUUID();

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "Embedding"
      (id, namespace, "sourceType", "sourceId", content, "vector",
       "businessId", "adAccountId", metadata, "createdAt", "updatedAt")
    VALUES
      (${newId}, ${input.namespace}, ${input.sourceType}, ${input.sourceId},
       ${input.content}, ${vecLiteral}::vector,
       ${input.businessId ?? null}, ${input.adAccountId ?? null},
       ${metadataJson}::jsonb, NOW(), NOW())
    ON CONFLICT ("namespace", "sourceType", "sourceId") DO UPDATE SET
      content      = EXCLUDED.content,
      "vector"     = EXCLUDED."vector",
      "businessId" = EXCLUDED."businessId",
      "adAccountId"= EXCLUDED."adAccountId",
      metadata     = EXCLUDED.metadata,
      "updatedAt"  = NOW()
    RETURNING id
  `;

  return { id: rows[0].id };
}

export interface SearchHit {
  id: string;
  sourceType: string;
  sourceId: string;
  content: string;
  /** Cosine distance — 0 is identical, 2 is opposite. Lower = more similar. */
  distance: number;
  metadata: Record<string, unknown>;
}

export interface SearchOptions {
  query: string;
  namespace: string;
  /** Tenant scope — at least one is REQUIRED to prevent cross-tenant leaks. */
  businessId?: string | null;
  adAccountId?: string | null;
  /** How many hits to return. Defaults to 8 — small enough to fit in prompts. */
  topK?: number;
}

/**
 * Embed `query` and return the top-K nearest neighbours from one namespace,
 * scoped to one tenant. Cosine distance via pgvector's `<=>` operator.
 *
 * Throws if no tenant scope is provided — this is a guardrail, not a
 * convenience. A search with no scope would return embeddings across every
 * client; never the right behaviour.
 */
export async function search(opts: SearchOptions): Promise<SearchHit[]> {
  if (!opts.businessId && !opts.adAccountId) {
    throw new Error(
      "search: businessId or adAccountId required (no cross-tenant lookups)",
    );
  }
  const topK = opts.topK ?? 8;

  const vec = await embedText(opts.query);
  const vecLiteral = `[${vec.join(",")}]`;

  // Build a dynamic, parameterised WHERE — Prisma.sql keeps everything safe.
  const conds: Prisma.Sql[] = [
    Prisma.sql`namespace = ${opts.namespace}`,
  ];
  if (opts.businessId) {
    conds.push(Prisma.sql`"businessId" = ${opts.businessId}`);
  }
  if (opts.adAccountId) {
    conds.push(Prisma.sql`"adAccountId" = ${opts.adAccountId}`);
  }
  const where = Prisma.join(conds, " AND ");

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      sourceType: string;
      sourceId: string;
      content: string;
      metadata: Record<string, unknown>;
      distance: number;
    }>
  >`
    SELECT
      id,
      "sourceType",
      "sourceId",
      content,
      metadata,
      ("vector" <=> ${vecLiteral}::vector) AS distance
    FROM "Embedding"
    WHERE ${where}
    ORDER BY distance ASC
    LIMIT ${topK}
  `;

  return rows.map((r) => ({
    id: r.id,
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    content: r.content,
    distance: Number(r.distance),
    metadata: r.metadata ?? {},
  }));
}

/**
 * Render hits as a single block of text ready to drop into an LLM `context`
 * field — saves every feature from re-writing the same stitching loop.
 */
export function formatHitsForPrompt(hits: SearchHit[]): string {
  return hits
    .map(
      (h, i) =>
        `[${i + 1}] (${h.sourceType}:${h.sourceId}) ${h.content.trim()}`,
    )
    .join("\n\n");
}

/**
 * Drop an entire namespace for one tenant — used when rebuilding a corpus
 * from scratch (e.g. the client uploaded a new brand-guidelines pack and
 * we want to wipe the old chunks before re-indexing).
 */
export async function deleteByNamespace(opts: {
  namespace: string;
  businessId?: string | null;
  adAccountId?: string | null;
}): Promise<{ count: number }> {
  if (!opts.businessId && !opts.adAccountId) {
    throw new Error(
      "deleteByNamespace: businessId or adAccountId required",
    );
  }
  const res = await prisma.embedding.deleteMany({
    where: {
      namespace: opts.namespace,
      businessId: opts.businessId ?? undefined,
      adAccountId: opts.adAccountId ?? undefined,
    },
  });
  return { count: res.count };
}
