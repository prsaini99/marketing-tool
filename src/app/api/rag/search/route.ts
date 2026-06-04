/**
 * RAG sanity-check endpoint — proves the foundation works end-to-end with
 * no UI. Drop a few rows via POST, then query them with GET; verify the
 * nearest-neighbour ordering matches intuition.
 *
 * POST /api/rag/search
 *   Body: { namespace, sourceId, content, accountId? | businessId?, metadata? }
 *   Indexes one chunk. `sourceType` defaults to "Test".
 *
 * GET /api/rag/search?q=<query>&namespace=<ns>&accountId=<act_…>&topK=<n>
 *   Returns the top-K nearest hits scoped to one tenant.
 *
 * These will be folded into proper per-feature endpoints (copy gen, audit,
 * ask-my-data, …) once we start building features on top. The intent here
 * is just: prove the plumbing is correct before anything else gets built.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { indexText, search } from "@/server/services/rag";

async function resolveAccountId(
  metaAdAccountIdParam: string,
): Promise<string> {
  const id = metaAdAccountIdParam.startsWith("act_")
    ? metaAdAccountIdParam
    : `act_${metaAdAccountIdParam}`;
  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId: id, selectedForSync: true },
    select: { id: true },
  });
  if (!account) {
    throw new Error("Ad account not found or not selected for sync");
  }
  return account.id;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const query = url.searchParams.get("q");
  const namespace = url.searchParams.get("namespace");
  const accountIdParam = url.searchParams.get("accountId");
  const businessIdParam = url.searchParams.get("businessId");
  const topKParam = url.searchParams.get("topK");

  if (!query?.trim()) {
    return NextResponse.json(
      { error: "q (query) is required" },
      { status: 400 },
    );
  }
  if (!namespace?.trim()) {
    return NextResponse.json(
      { error: "namespace is required" },
      { status: 400 },
    );
  }
  if (!accountIdParam && !businessIdParam) {
    return NextResponse.json(
      { error: "accountId or businessId is required (tenant scope)" },
      { status: 400 },
    );
  }
  const topK = topKParam ? Math.max(1, Math.min(50, Number(topKParam))) : 8;

  try {
    const adAccountId = accountIdParam
      ? await resolveAccountId(accountIdParam)
      : null;
    const hits = await search({
      query: query.trim(),
      namespace: namespace.trim(),
      businessId: businessIdParam ?? null,
      adAccountId,
      topK,
    });
    return NextResponse.json({ hits });
  } catch (err) {
    console.error("rag search error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: {
    namespace?: unknown;
    sourceType?: unknown;
    sourceId?: unknown;
    content?: unknown;
    accountId?: unknown;
    businessId?: unknown;
    metadata?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const namespace = str(body.namespace);
  const sourceId = str(body.sourceId);
  const content = str(body.content);
  const accountIdParam = str(body.accountId);
  const businessIdParam = str(body.businessId);
  const sourceType = str(body.sourceType) || "Test";

  if (!namespace) {
    return NextResponse.json(
      { error: "namespace is required" },
      { status: 400 },
    );
  }
  if (!sourceId) {
    return NextResponse.json(
      { error: "sourceId is required" },
      { status: 400 },
    );
  }
  if (!content) {
    return NextResponse.json(
      { error: "content is required" },
      { status: 400 },
    );
  }
  if (!accountIdParam && !businessIdParam) {
    return NextResponse.json(
      { error: "accountId or businessId is required (tenant scope)" },
      { status: 400 },
    );
  }

  try {
    const adAccountId = accountIdParam
      ? await resolveAccountId(accountIdParam)
      : null;
    const result = await indexText({
      namespace,
      sourceType,
      sourceId,
      content,
      businessId: businessIdParam || null,
      adAccountId,
      metadata:
        body.metadata && typeof body.metadata === "object"
          ? (body.metadata as Record<string, unknown>)
          : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("rag index error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
