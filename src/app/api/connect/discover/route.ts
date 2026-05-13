import { NextResponse } from "next/server";
import { MetaApiError } from "@/lib/meta/client";
import { createConnectionFromToken } from "@/server/services/connections/discover";

interface DiscoverRequestBody {
  token?: unknown;
  label?: unknown;
}

export async function POST(req: Request) {
  let body: DiscoverRequestBody;
  try {
    body = (await req.json()) as DiscoverRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const label = typeof body.label === "string" ? body.label : undefined;

  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  try {
    const result = await createConnectionFromToken({ token, label });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      // 4xx Meta errors = caller-fixable; 5xx = upstream issue we surface as 502.
      const status = err.httpStatus >= 500 ? 502 : 400;
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status },
      );
    }
    console.error(
      "discover error:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
