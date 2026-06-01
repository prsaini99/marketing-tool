/**
 * POST /api/audiences
 *
 * Create a customer-list custom audience: empty container + hashed user
 * upload. See src/server/services/audiences/create.ts for the flow.
 *
 * Body:
 *   {
 *     metaAdAccountId: string,    // act_-prefixed or unprefixed
 *     name: string,
 *     description?: string,
 *     emailsBlob?: string,        // free-text emails (newline/comma/; sep)
 *     phonesBlob?: string,        // free-text phones
 *   }
 *
 * Plaintext PII is hashed server-side and never persisted. Only hashes go
 * to Meta.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { MetaApiError } from "@/lib/meta/client";
import { createCustomAudience } from "@/server/services/audiences/create";
import { createWebsiteAudience } from "@/server/services/audiences/create-website";
import { createLookalikeAudience } from "@/server/services/audiences/create-lookalike";
import {
  createEngagementAudience,
  type EngagementEvent,
} from "@/server/services/audiences/create-engagement";

interface Body {
  // "customer_list" (default) | "website" | "lookalike" | "engagement".
  subtype?: unknown;
  metaAdAccountId?: unknown;
  name?: unknown;
  description?: unknown;
  // customer_list fields
  emailsBlob?: unknown;
  phonesBlob?: unknown;
  // website fields
  pixelId?: unknown;
  retentionDays?: unknown;
  urlContains?: unknown;
  // lookalike fields
  originAudienceId?: unknown;
  country?: unknown;
  ratio?: unknown;
  // engagement fields
  pageId?: unknown;
  event?: unknown;
}

const ENGAGEMENT_EVENTS: EngagementEvent[] = [
  "page_engaged",
  "page_visited",
  "page_messaged",
];

/**
 * GET /api/audiences?accountId=X — synced audiences for an account, used to
 * populate the Lookalike "source audience" picker. Excludes lookalikes
 * (a lookalike can't be a source) and only returns ready-ish ones.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const accountIdParam = url.searchParams.get("accountId");
  if (!accountIdParam) {
    return NextResponse.json(
      { error: "accountId query param is required" },
      { status: 400 },
    );
  }
  const metaAdAccountId = accountIdParam.startsWith("act_")
    ? accountIdParam
    : `act_${accountIdParam}`;
  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId, selectedForSync: true },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Ad account not found or not selected for sync" },
      { status: 404 },
    );
  }
  const audiences = await prisma.customAudience.findMany({
    where: {
      adAccountId: account.id,
      NOT: { subtype: "LOOKALIKE" },
    },
    select: {
      metaAudienceId: true,
      name: true,
      subtype: true,
      approximateCount: true,
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({
    audiences: audiences.map((a) => ({
      id: a.metaAudienceId,
      name: a.name,
      subtype: a.subtype,
      approximateCount: a.approximateCount,
    })),
  });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body.metaAdAccountId !== "string" ||
    !body.metaAdAccountId.trim()
  ) {
    return NextResponse.json(
      { error: "metaAdAccountId is required" },
      { status: 400 },
    );
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const subtype =
    body.subtype === "website" ||
    body.subtype === "lookalike" ||
    body.subtype === "engagement"
      ? body.subtype
      : "customer_list";

  try {
    if (subtype === "website") {
      if (typeof body.pixelId !== "string" || !body.pixelId.trim()) {
        return NextResponse.json(
          { error: "pixelId is required for a website audience" },
          { status: 400 },
        );
      }
      const retentionDays =
        typeof body.retentionDays === "number" ? body.retentionDays : 30;
      const result = await createWebsiteAudience({
        metaAdAccountId: body.metaAdAccountId,
        name: body.name,
        description:
          typeof body.description === "string" ? body.description : undefined,
        pixelId: body.pixelId,
        retentionDays,
        urlContains:
          typeof body.urlContains === "string" ? body.urlContains : undefined,
      });
      return NextResponse.json(result);
    }

    if (subtype === "lookalike") {
      if (
        typeof body.originAudienceId !== "string" ||
        !body.originAudienceId.trim()
      ) {
        return NextResponse.json(
          { error: "originAudienceId is required for a lookalike" },
          { status: 400 },
        );
      }
      if (typeof body.country !== "string" || !body.country.trim()) {
        return NextResponse.json(
          { error: "country is required for a lookalike" },
          { status: 400 },
        );
      }
      const ratio = typeof body.ratio === "number" ? body.ratio : 0.01;
      const result = await createLookalikeAudience({
        metaAdAccountId: body.metaAdAccountId,
        name: body.name,
        description:
          typeof body.description === "string" ? body.description : undefined,
        originAudienceId: body.originAudienceId,
        country: body.country,
        ratio,
      });
      return NextResponse.json(result);
    }

    if (subtype === "engagement") {
      if (typeof body.pageId !== "string" || !body.pageId.trim()) {
        return NextResponse.json(
          { error: "pageId is required for an engagement audience" },
          { status: 400 },
        );
      }
      const event = ENGAGEMENT_EVENTS.includes(body.event as EngagementEvent)
        ? (body.event as EngagementEvent)
        : "page_engaged";
      const retentionDays =
        typeof body.retentionDays === "number" ? body.retentionDays : 30;
      const result = await createEngagementAudience({
        metaAdAccountId: body.metaAdAccountId,
        name: body.name,
        description:
          typeof body.description === "string" ? body.description : undefined,
        pageId: body.pageId,
        event,
        retentionDays,
      });
      return NextResponse.json(result);
    }

    const result = await createCustomAudience({
      metaAdAccountId: body.metaAdAccountId,
      name: body.name,
      description:
        typeof body.description === "string" ? body.description : undefined,
      emailsBlob:
        typeof body.emailsBlob === "string" ? body.emailsBlob : undefined,
      phonesBlob:
        typeof body.phonesBlob === "string" ? body.phonesBlob : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("create audience error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
