import { describe, expect, it } from "vitest";
import {
  needsStoreRetry,
  toPublic,
} from "@/server/services/video/generation";

/**
 * toPublic is the one pure function in the video service, and it decides the
 * thing this branch's final review was about: whether a paid clip we failed
 * to store is still reachable, or whether the operator is told to pay again.
 */
const base = {
  id: "vid_1",
  status: "READY",
  error: null,
  vendorUrl: null as string | null,
  storagePath: null as string | null,
  aspectRatio: "9:16",
  formatId: "product-hero",
  createdAt: new Date("2026-08-28T10:00:00.000Z"),
};

describe("toPublic", () => {
  it("serves the stored copy through /api/media when there is one", () => {
    const out = toPublic({ ...base, storagePath: "videos/_workspace/vid_1" });
    expect(out.videoUrl).toBe("/api/media/videos/_workspace/vid_1");
    expect(out.expiresSoon).toBe(false);
  });

  it("prefers the stored copy even when a vendor URL is also on the row", () => {
    const out = toPublic({
      ...base,
      storagePath: "videos/_workspace/vid_1",
      vendorUrl: "https://vendor.example/clip.mp4",
    });
    expect(out.videoUrl).toBe("/api/media/videos/_workspace/vid_1");
    expect(out.expiresSoon).toBe(false);
  });

  it("falls back to the vendor URL, flagged, when storing failed", () => {
    const out = toPublic({
      ...base,
      vendorUrl: "https://vendor.example/clip.mp4",
    });
    expect(out.videoUrl).toBe("https://vendor.example/clip.mp4");
    expect(out.expiresSoon).toBe(true);
  });

  it("offers nothing when the job is READY with neither copy", () => {
    const out = toPublic(base);
    expect(out.videoUrl).toBeNull();
    expect(out.expiresSoon).toBe(false);
  });

  it("never offers a vendor URL for a job that is not READY", () => {
    for (const status of ["QUEUED", "RUNNING", "FAILED", "CANCELLED"]) {
      const out = toPublic({
        ...base,
        status,
        vendorUrl: "https://vendor.example/clip.mp4",
      });
      expect(out.videoUrl).toBeNull();
      expect(out.expiresSoon).toBe(false);
    }
  });
});

/**
 * The retry bound. Without it the READY branch re-downloads the full clip from
 * the vendor on every advance — every mount and every Still/Video toggle, for
 * every unstored clip in the list at once.
 */
describe("needsStoreRetry", () => {
  const fresh = {
    storagePath: null as string | null,
    vendorUrl: "https://vendor.example/clip.mp4" as string | null,
    storeAttemptedAt: null as Date | null,
    createdAt: new Date(),
  };
  const ago = (ms: number) => new Date(Date.now() - ms);

  it("retries a clip that was never attempted", () => {
    expect(needsStoreRetry(fresh)).toBe(true);
  });

  it("never retries one that is already stored", () => {
    expect(
      needsStoreRetry({ ...fresh, storagePath: "videos/_workspace/v1" }),
    ).toBe(false);
  });

  it("has nothing to retry without a vendor URL", () => {
    expect(needsStoreRetry({ ...fresh, vendorUrl: null })).toBe(false);
  });

  it("holds off on an attempt made moments ago", () => {
    expect(
      needsStoreRetry({ ...fresh, storeAttemptedAt: ago(60 * 1000) }),
    ).toBe(false);
  });

  it("tries again once the spacing has passed", () => {
    expect(
      needsStoreRetry({ ...fresh, storeAttemptedAt: ago(11 * 60 * 1000) }),
    ).toBe(true);
  });

  it("gives up once the vendor URL is past its lifetime", () => {
    expect(
      needsStoreRetry({ ...fresh, createdAt: ago(8 * 24 * 60 * 60 * 1000) }),
    ).toBe(false);
  });
});
