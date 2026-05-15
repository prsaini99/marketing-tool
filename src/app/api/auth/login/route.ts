/**
 * POST /api/auth/login
 *
 * Body: { email: string, password: string }
 *
 * Validates against MASTER_EMAIL + MASTER_PASSWORD in env. On success sets
 * the signed session cookie; on failure returns 401 with a generic message
 * (don't reveal which field was wrong).
 */

import { NextResponse } from "next/server";
import {
  getExpectedSessionValue,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  verifyCredentials,
} from "@/lib/auth";

interface Body {
  email?: unknown;
  password?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  if (!verifyCredentials(body.email, body.password)) {
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 },
    );
  }

  const sessionValue = await getExpectedSessionValue();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: sessionValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
