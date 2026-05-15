/**
 * POST /api/auth/logout
 *
 * Clears the session cookie. No body required.
 */

import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Set to empty + Max-Age=0 to expire immediately. The path must match the
  // one used at set time (/) for the browser to accept the deletion.
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
