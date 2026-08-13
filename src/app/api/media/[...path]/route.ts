/**
 * GET /api/media/<storage path>
 *
 * Streams one asset out of the private meta-assets bucket.
 *
 * WHY A ROUTE RATHER THAN PUBLIC OR SIGNED URLS. The bucket is private
 * because it holds client ad creatives, and a public bucket serves anything
 * to anyone who guesses a path. Signed URLs would work but cost a signing
 * round trip per thumbnail, which is forty of them on the creative gallery.
 * This route inherits the session check that src/middleware.ts already
 * applies to every /api/* path, so the same guarantee costs nothing extra.
 *
 * Cached hard and immutable: paths are content-addressed, so the bytes at a
 * given path never change. A new asset is a new path.
 */

import { NextResponse } from "next/server";
import { readAsset } from "@/lib/storage/assets";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const key = path.join("/");

  // Defence in depth. Next already decodes and splits the segments, so "..“
  // should not survive to here, but a path traversal into another tenant's
  // assets is not a thing to leave to "should".
  if (!key || path.some((seg) => seg === ".." || seg === "." || seg.includes("/"))) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const asset = await readAsset(key);
  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(asset.body, {
    status: 200,
    headers: {
      "content-type": asset.contentType,
      "content-length": String(asset.body.byteLength),
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
