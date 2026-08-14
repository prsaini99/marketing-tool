/**
 * POST /api/public/demo-request
 *
 * The demo form on the marketing site. Unauthenticated by necessity: the
 * people filling it in are prospects, not users.
 *
 * THIS IS THE ONLY WRITE ENDPOINT AN ANONYMOUS CALLER CAN REACH. The
 * middleware exempts the /api/public/ prefix (see src/middleware.ts), so
 * anything added under that prefix in future is world-writable by default.
 * Nothing else belongs there without the same three defences this has:
 *
 *   1. A honeypot field, so naive bots identify themselves.
 *   2. A per-IP rate limit, so a determined one cannot fill the table.
 *   3. Strict bounded validation, since every value is attacker-supplied.
 *
 * Spam is answered with 200 and discarded rather than rejected. Telling a
 * bot it was detected only teaches whoever wrote it to leave the honeypot
 * alone next time.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { clientIpFrom, createRateLimiter } from "@/lib/rate-limit";
import { validateDemoRequest } from "@/lib/demo-request";

/**
 * Five submissions per IP per hour.
 *
 * High enough that a person who mistypes their email and resubmits is never
 * blocked, low enough that flooding the table needs a botnet rather than a
 * loop. Module scope means per serverless instance; see the note in
 * rate-limit.ts about what that does and does not buy.
 */
const limiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });

export async function POST(req: Request) {
  const ip = clientIpFrom(req.headers);
  const gate = limiter.check(ip, Date.now());
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please email us directly." },
      { status: 429, headers: { "retry-after": String(gate.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const result = validateDemoRequest(body as Record<string, unknown>);

  if (!result.ok && "spam" in result) {
    // Look identical to success from the outside.
    return NextResponse.json({ ok: true });
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, field: result.field },
      { status: 400 },
    );
  }

  try {
    await prisma.demoRequest.create({ data: result.value });
  } catch (e) {
    console.error(
      "[demo-request] failed to store:",
      e instanceof Error ? e.message : e,
    );
    // Deliberately vague. The submitter cannot act on a database error, and
    // the fallback that actually helps them is the email address on the page.
    return NextResponse.json(
      { error: "Something went wrong. Please email us directly." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
