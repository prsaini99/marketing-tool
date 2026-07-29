/**
 * PUT /api/automation/accounts/[id]/profile — replace the bot profile.
 * FAQs are replace-all (delete + recreate): the editor submits the full
 * list, and diffing rows buys nothing at this size.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

interface FaqInput {
  question?: unknown;
  answer?: unknown;
}

interface Body {
  businessDescription?: unknown;
  toneRules?: unknown;
  links?: unknown;
  bannedTopics?: unknown;
  languageMode?: unknown;
  aiFallbackEnabled?: unknown;
  optOutConfirmation?: unknown;
  faqs?: unknown;
}

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const account = await prisma.instagramAccount.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const links: Record<string, string> = {};
  if (body.links && typeof body.links === "object") {
    for (const [k, v] of Object.entries(body.links as Record<string, unknown>)) {
      if (typeof v === "string" && k.trim()) links[k.trim()] = v;
    }
  }
  const bannedTopics = Array.isArray(body.bannedTopics)
    ? (body.bannedTopics as unknown[]).filter(
        (t): t is string => typeof t === "string" && t.trim().length > 0,
      )
    : [];
  const faqs = (Array.isArray(body.faqs) ? (body.faqs as FaqInput[]) : [])
    .map((f) => ({ question: asStr(f?.question).trim(), answer: asStr(f?.answer).trim() }))
    .filter((f) => f.question && f.answer);

  const profile = await prisma.botProfile.upsert({
    where: { igAccountId: id },
    create: {
      igAccountId: id,
      businessDescription: asStr(body.businessDescription),
      toneRules: asStr(body.toneRules),
      linksJson: links,
      bannedTopics,
      languageMode: asStr(body.languageMode, "mirror") || "mirror",
      aiFallbackEnabled: body.aiFallbackEnabled === true,
      optOutConfirmation:
        asStr(body.optOutConfirmation) ||
        "You've been unsubscribed and won't receive more messages.",
    },
    update: {
      businessDescription: asStr(body.businessDescription),
      toneRules: asStr(body.toneRules),
      linksJson: links,
      bannedTopics,
      languageMode: asStr(body.languageMode, "mirror") || "mirror",
      aiFallbackEnabled: body.aiFallbackEnabled === true,
      optOutConfirmation:
        asStr(body.optOutConfirmation) ||
        "You've been unsubscribed and won't receive more messages.",
    },
  });

  await prisma.botFaq.deleteMany({ where: { profileId: profile.id } });
  if (faqs.length > 0) {
    await prisma.botFaq.createMany({
      data: faqs.map((f, i) => ({
        profileId: profile.id,
        question: f.question,
        answer: f.answer,
        sortOrder: i,
      })),
    });
  }

  return NextResponse.json({ ok: true });
}
