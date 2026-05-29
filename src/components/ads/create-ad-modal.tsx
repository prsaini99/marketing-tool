"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ImagePlus,
  Loader2,
  UploadCloud,
  Video as VideoIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { pollVideoUntilReady, uploadVideoChunked } from "@/lib/upload-video";

interface ParentAdSet {
  metaAdSetId: string;
  name: string;
}

interface CreateAdModalProps {
  open: boolean;
  adSet: ParentAdSet;
  // Parent ad account's Meta id (act_…) — scopes the video library picker.
  metaAdAccountId: string;
  onClose: () => void;
}

type MediaType = "image" | "video";

interface LibraryImage {
  hash: string;
  url: string | null;
  name: string | null;
  width: number | null;
  height: number | null;
}

interface LibraryVideo {
  videoId: string;
  title: string | null;
  thumbnailUrl: string | null;
  status: string | null;
  lengthSeconds: number | null;
}

// A library video is usable as a creative only once Meta has finished
// processing it (status `ready`) AND produced a poster — Meta rejects a
// video creative with no `image_url`. Page-uploaded videos with an unknown
// status but a thumbnail are allowed through (the poster is what Meta needs).
function isVideoUsable(v: LibraryVideo): boolean {
  if (!v.thumbnailUrl) return false;
  const s = v.status?.toLowerCase();
  return !s || s === "ready";
}

function formatLength(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const CTA_OPTIONS = [
  { value: "SHOP_NOW", label: "Shop Now" },
  { value: "LEARN_MORE", label: "Learn More" },
  { value: "SIGN_UP", label: "Sign Up" },
  { value: "SUBSCRIBE", label: "Subscribe" },
  { value: "DOWNLOAD", label: "Download" },
  { value: "GET_QUOTE", label: "Get Quote" },
  { value: "CONTACT_US", label: "Contact Us" },
  { value: "APPLY_NOW", label: "Apply Now" },
  { value: "BOOK_TRAVEL", label: "Book Now" },
  { value: "WATCH_MORE", label: "Watch More" },
  { value: "ORDER_NOW", label: "Order Now" },
  { value: "GET_OFFER", label: "Get Offer" },
  { value: "SEND_MESSAGE", label: "Send Message" },
  { value: "NO_BUTTON", label: "No button" },
];

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function CreateAdModal({
  open,
  adSet,
  metaAdAccountId,
  onClose,
}: CreateAdModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Form state ────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [pageId, setPageId] = useState("");
  const [instagramActorId, setInstagramActorId] = useState("");
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [callToAction, setCallToAction] = useState("SHOP_NOW");
  const [status, setStatus] = useState<"PAUSED" | "ACTIVE">("PAUSED");

  // ── Media: image (upload or library) OR a library video ───────────────
  const [mediaType, setMediaType] = useState<MediaType>("image");
  const [imageSource, setImageSource] = useState<"upload" | "library">(
    "upload",
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [images, setImages] = useState<LibraryImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesError, setImagesError] = useState<string | null>(null);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [selectedImageHash, setSelectedImageHash] = useState<string | null>(
    null,
  );
  const selectedImage =
    images.find((i) => i.hash === selectedImageHash) ?? null;

  const [videoSource, setVideoSource] = useState<"upload" | "library">(
    "library",
  );
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosError, setVideosError] = useState<string | null>(null);
  const [videosLoaded, setVideosLoaded] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  // A video uploaded inline during this session — it isn't in the synced
  // `videos` list, so we track it separately and fold it into the selection.
  const [uploadedVideo, setUploadedVideo] = useState<LibraryVideo | null>(null);
  const selectedVideo =
    (uploadedVideo && uploadedVideo.videoId === selectedVideoId
      ? uploadedVideo
      : videos.find((v) => v.videoId === selectedVideoId)) ?? null;

  const firstFieldRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset on close.
  useEffect(() => {
    if (open) return;
    setName("");
    setPageId("");
    setInstagramActorId("");
    setLink("");
    setMessage("");
    setHeadline("");
    setDescription("");
    setCallToAction("SHOP_NOW");
    setStatus("PAUSED");
    setMediaType("image");
    setImageSource("upload");
    setImageFile(null);
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setImages([]);
    setImagesLoading(false);
    setImagesError(null);
    setImagesLoaded(false);
    setSelectedImageHash(null);
    setVideoSource("library");
    setVideos([]);
    setVideosLoading(false);
    setVideosError(null);
    setVideosLoaded(false);
    setSelectedVideoId(null);
    setUploadedVideo(null);
    setShowAdvanced(false);
    setError(null);
  }, [open]);

  // Lazily load the account's library images the first time the user opens the
  // image-library picker. Same self-cancel caveat as the videos effect below:
  // imagesLoading is intentionally NOT a dependency.
  useEffect(() => {
    if (
      !open ||
      mediaType !== "image" ||
      imageSource !== "library" ||
      imagesLoaded
    ) {
      return;
    }
    let cancelled = false;
    setImagesLoading(true);
    setImagesError(null);
    fetch(`/api/images?accountId=${encodeURIComponent(metaAdAccountId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        setImages(Array.isArray(data.images) ? data.images : []);
        setImagesLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setImagesError(
          err instanceof Error ? err.message : "Failed to load images",
        );
      })
      .finally(() => {
        if (!cancelled) setImagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mediaType, imageSource, metaAdAccountId, imagesLoaded]);

  // Lazily load the account's library videos the first time the user switches
  // to the Video tab — keeps the modal cheap to open for the common image case.
  // NOTE: videosLoading is deliberately NOT a dependency here — setting it
  // inside the effect would otherwise re-trigger the effect, whose cleanup
  // cancels the in-flight fetch and leaves the picker stuck on "Loading…".
  useEffect(() => {
    if (!open || mediaType !== "video" || videosLoaded) {
      return;
    }
    let cancelled = false;
    setVideosLoading(true);
    setVideosError(null);
    fetch(`/api/videos?accountId=${encodeURIComponent(metaAdAccountId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        setVideos(Array.isArray(data.videos) ? data.videos : []);
        setVideosLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setVideosError(
          err instanceof Error ? err.message : "Failed to load videos",
        );
      })
      .finally(() => {
        if (!cancelled) setVideosLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mediaType, metaAdAccountId, videosLoaded]);

  useEffect(() => {
    if (!open) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => firstFieldRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Clean up the previously-allocated preview URL when picking a new file.
  function handleFile(file: File | null) {
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (!file) {
      setImageFile(null);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(
        `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
      );
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Please pick an image file.");
      return;
    }
    setError(null);
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
  }

  // ── Validation ────────────────────────────────────────────────────────
  const validationError = (() => {
    if (!name.trim()) return "Ad name is required.";
    if (!pageId.trim()) return "Facebook Page ID is required.";
    if (!link.trim()) return "Destination URL is required.";
    if (!/^https?:\/\//i.test(link.trim())) {
      return "Destination URL must start with http(s)://";
    }
    if (!message.trim()) return "Primary text is required.";
    if (!headline.trim()) return "Headline is required.";
    if (mediaType === "image") {
      if (imageSource === "upload") {
        if (!imageFile) return "Pick an image to upload.";
      } else {
        if (!selectedImage) return "Pick an image from the library.";
      }
    } else {
      if (!selectedVideo) return "Pick a video from the library.";
      if (!isVideoUsable(selectedVideo)) {
        return "Selected video isn't ready — pick one that's processed.";
      }
    }
    return null;
  })();

  // ── Live preview payload — link_data for image, video_data for video ──
  const callToActionPreview = {
    type: callToAction,
    value: { link: link || "(empty)" },
  };
  const previewObjectStorySpec: Record<string, unknown> = {
    page_id: pageId || "(empty)",
  };
  if (mediaType === "image") {
    const previewImageHash =
      imageSource === "library"
        ? (selectedImage?.hash ?? "(no image)")
        : imageFile
          ? `[uploaded — ${imageFile.name}]`
          : "(no image)";
    const previewLinkData: Record<string, unknown> = {
      link: link || "(empty)",
      message: message || "(empty)",
      name: headline || "(empty)",
      image_hash: previewImageHash,
      call_to_action: callToActionPreview,
    };
    if (description.trim()) previewLinkData.description = description.trim();
    previewObjectStorySpec.link_data = previewLinkData;
  } else {
    const previewVideoData: Record<string, unknown> = {
      video_id: selectedVideo?.videoId ?? "(no video)",
      title: headline || "(empty)",
      message: message || "(empty)",
      image_url: selectedVideo?.thumbnailUrl ?? "(no poster)",
      call_to_action: callToActionPreview,
    };
    if (description.trim()) {
      previewVideoData.link_description = description.trim();
    }
    previewObjectStorySpec.video_data = previewVideoData;
  }
  if (instagramActorId.trim()) {
    previewObjectStorySpec.instagram_actor_id = instagramActorId.trim();
  }

  const previewPayload = {
    name: name || "(empty)",
    adset_id: adSet.metaAdSetId,
    status,
    creative: { object_story_spec: previewObjectStorySpec },
  };

  async function submit() {
    if (validationError) return;
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("metaAdSetId", adSet.metaAdSetId);
      form.set("name", name.trim());
      form.set("status", status);
      form.set("mediaType", mediaType);
      form.set("pageId", pageId.trim());
      if (instagramActorId.trim()) {
        form.set("instagramActorId", instagramActorId.trim());
      }
      form.set("link", link.trim());
      form.set("message", message.trim());
      form.set("headline", headline.trim());
      if (description.trim()) form.set("description", description.trim());
      form.set("callToAction", callToAction);
      if (mediaType === "image") {
        if (imageSource === "library") {
          if (!selectedImage) return;
          form.set("imageHash", selectedImage.hash);
          if (selectedImage.url) form.set("imageUrl", selectedImage.url);
        } else {
          if (!imageFile) return;
          form.set("image", imageFile, imageFile.name);
        }
      } else {
        if (!selectedVideo?.thumbnailUrl) return;
        form.set("videoId", selectedVideo.videoId);
        form.set("thumbnailUrl", selectedVideo.thumbnailUrl);
      }

      const res = await fetch("/api/ads", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ad");
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-ad-title"
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-background shadow-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h2
              id="create-ad-title"
              className="text-sm font-semibold tracking-tight"
            >
              New ad
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Under{" "}
              <span className="font-medium text-foreground">{adSet.name}</span>{" "}
              · Created as{" "}
              <span className="font-medium text-foreground">PAUSED</span> by
              default.{" "}
              {mediaType === "image"
                ? "Single image link ad."
                : "Single video link ad."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_320px]">
            {/* ── Form ─────────────────────────────────────────────── */}
            <div className="space-y-4 border-b border-border px-5 py-4 lg:border-b-0 lg:border-r">
              {/* Name */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Ad name <span className="text-danger">*</span>
                </label>
                <input
                  ref={firstFieldRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Diwali Saree — Hero image v1"
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {/* Identity */}
              <div className="space-y-3 rounded-md border border-border bg-background px-3 py-3">
                <div className="text-xs font-semibold text-foreground">
                  Identity
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    Facebook Page ID <span className="text-danger">*</span>
                  </label>
                  <input
                    type="text"
                    value={pageId}
                    onChange={(e) => setPageId(e.target.value)}
                    placeholder="e.g. 1234567890"
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <p className="text-[11px] text-subtle">
                    The Page the ad runs from. Find it in your Page → About → Page ID.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    Instagram account ID (optional)
                  </label>
                  <input
                    type="text"
                    value={instagramActorId}
                    onChange={(e) => setInstagramActorId(e.target.value)}
                    placeholder="Leave blank to use the Page's linked IG"
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>

              {/* Media */}
              <div className="space-y-2 rounded-md border border-border bg-background px-3 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-foreground">
                    Media <span className="text-danger">*</span>
                  </div>
                  <div className="inline-flex rounded-md border border-border bg-surface p-0.5 text-xs">
                    {(["image", "video"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setMediaType(m);
                          setError(null);
                        }}
                        disabled={submitting}
                        className={cn(
                          "rounded-sm px-2.5 py-1 font-medium transition-colors",
                          mediaType === m
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted hover:text-foreground",
                        )}
                      >
                        {m === "image" ? "Image" : "Video"}
                      </button>
                    ))}
                  </div>
                </div>

                {mediaType === "image" ? (
                  <div className="space-y-2">
                    {/* Upload a new image, or pick one already in the library. */}
                    <div className="inline-flex rounded-md border border-border bg-surface p-0.5 text-[11px]">
                      {(["upload", "library"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            setImageSource(s);
                            setError(null);
                          }}
                          disabled={submitting}
                          className={cn(
                            "rounded-sm px-2 py-0.5 font-medium transition-colors",
                            imageSource === s
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted hover:text-foreground",
                          )}
                        >
                          {s === "upload" ? "Upload new" : "From library"}
                        </button>
                      ))}
                    </div>

                    {imageSource === "upload" ? (
                      <>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={(e) =>
                            handleFile(e.target.files?.[0] ?? null)
                          }
                          disabled={submitting}
                          className="hidden"
                        />
                        {imagePreviewUrl ? (
                          <div className="space-y-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={imagePreviewUrl}
                              alt="Selected creative"
                              className="max-h-64 w-full rounded-md border border-border object-contain"
                            />
                            <div className="flex items-center justify-between text-[11px] text-subtle">
                              <span className="truncate">
                                {imageFile?.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  handleFile(null);
                                  if (fileInputRef.current) {
                                    fileInputRef.current.value = "";
                                  }
                                }}
                                disabled={submitting}
                                className="ml-2 shrink-0 rounded border border-border bg-background px-2 py-0.5 hover:bg-surface-2"
                              >
                                Replace
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={submitting}
                            className="flex w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-surface px-4 py-6 text-xs text-muted hover:bg-surface-2 transition-colors"
                          >
                            <ImagePlus className="h-5 w-5 text-subtle" />
                            <span>Click to choose an image</span>
                            <span className="text-[10px] text-subtle">
                              JPG / PNG · up to {MAX_IMAGE_BYTES / 1024 / 1024}{" "}
                              MB · 1080×1080+ recommended
                            </span>
                          </button>
                        )}
                      </>
                    ) : (
                      <ImagePicker
                        images={images}
                        loading={imagesLoading}
                        error={imagesError}
                        selectedHash={selectedImageHash}
                        onSelect={(hash) => {
                          setSelectedImageHash(hash);
                          setError(null);
                        }}
                        disabled={submitting}
                      />
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Upload a new video, or pick one from the library. */}
                    <div className="inline-flex rounded-md border border-border bg-surface p-0.5 text-[11px]">
                      {(["upload", "library"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            setVideoSource(s);
                            setError(null);
                          }}
                          disabled={submitting}
                          className={cn(
                            "rounded-sm px-2 py-0.5 font-medium transition-colors",
                            videoSource === s
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted hover:text-foreground",
                          )}
                        >
                          {s === "upload" ? "Upload new" : "From library"}
                        </button>
                      ))}
                    </div>

                    {videoSource === "upload" ? (
                      <VideoUploadPanel
                        metaAdAccountId={metaAdAccountId}
                        disabled={submitting}
                        uploadedVideo={uploadedVideo}
                        onUploaded={(v) => {
                          setUploadedVideo(v);
                          setSelectedVideoId(v.videoId);
                          setError(null);
                        }}
                        onReset={() => {
                          setUploadedVideo(null);
                          setSelectedVideoId(null);
                        }}
                      />
                    ) : (
                      <VideoPicker
                        videos={videos}
                        loading={videosLoading}
                        error={videosError}
                        selectedVideoId={selectedVideoId}
                        onSelect={(id) => {
                          setSelectedVideoId(id);
                          setError(null);
                        }}
                        disabled={submitting}
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Copy */}
              <div className="space-y-3 rounded-md border border-border bg-background px-3 py-3">
                <div className="text-xs font-semibold text-foreground">
                  Copy
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    Primary text <span className="text-danger">*</span>
                  </label>
                  <textarea
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="The body copy above the image. Keep it punchy."
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    Headline <span className="text-danger">*</span>
                  </label>
                  <input
                    type="text"
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    placeholder="e.g. Diwali Saree Sale — 50% off"
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Small text under the headline."
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>

              {/* Destination + CTA */}
              <div className="space-y-3 rounded-md border border-border bg-background px-3 py-3">
                <div className="text-xs font-semibold text-foreground">
                  Destination & action
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    Website URL <span className="text-danger">*</span>
                  </label>
                  <input
                    type="url"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="https://example.com/products/saree"
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    Call to action <span className="text-danger">*</span>
                  </label>
                  <select
                    value={callToAction}
                    onChange={(e) => setCallToAction(e.target.value)}
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {CTA_OPTIONS.map((cta) => (
                      <option key={cta.value} value={cta.value}>
                        {cta.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Advanced — status */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="text-xs text-muted hover:text-foreground"
                >
                  {showAdvanced ? "Hide advanced ▴" : "Show advanced ▾"}
                </button>
                {showAdvanced && (
                  <div className="mt-2 space-y-3 rounded-md border border-border bg-surface px-3 py-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground">
                        Start status
                      </label>
                      <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
                        {(["PAUSED", "ACTIVE"] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setStatus(s)}
                            disabled={submitting}
                            className={cn(
                              "rounded-sm px-2.5 py-1 font-medium transition-colors",
                              status === s
                                ? s === "ACTIVE"
                                  ? "bg-red-50 text-red-700"
                                  : "bg-surface-2 text-foreground"
                                : "text-muted hover:text-foreground",
                            )}
                          >
                            {s === "PAUSED" ? "Paused" : "Active"}
                          </button>
                        ))}
                      </div>
                      {status === "ACTIVE" && (
                        <p className="mt-1 flex items-start gap-1 text-[11px] text-danger">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          Ad will go to Meta&apos;s review queue immediately
                          and start delivering once approved (assuming parent
                          ad set + campaign are also active).
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Preview ────────────────────────────────────────── */}
            <div className="bg-surface px-5 py-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">
                Meta payload
              </div>
              <p className="mt-0.5 text-[11px] text-subtle">
                {mediaType === "image" ? (
                  imageSource === "library" ? (
                    <>
                      The library image is referenced by its existing{" "}
                      <span className="font-mono">image_hash</span> (no upload),
                      then the ad is created (
                      <span className="font-mono">POST /act_*/ads</span>).
                    </>
                  ) : (
                    <>
                      Image is uploaded first (
                      <span className="font-mono">POST /act_*/adimages</span>) to
                      get a hash, then the ad is created (
                      <span className="font-mono">POST /act_*/ads</span>)
                      referencing that hash.
                    </>
                  )
                ) : (
                  <>
                    The library video is referenced by id (its poster becomes{" "}
                    <span className="font-mono">image_url</span>), then the ad is
                    created (
                    <span className="font-mono">POST /act_*/ads</span>) with a{" "}
                    <span className="font-mono">video_data</span> creative.
                  </>
                )}
              </p>
              <pre className="mt-3 max-h-[40vh] overflow-auto rounded-md border border-border bg-background p-3 text-[11px] leading-relaxed text-foreground">
                {JSON.stringify(previewPayload, null, 2)}
              </pre>
              <div className="mt-3 space-y-1 text-[11px] text-subtle">
                <div className="flex justify-between">
                  <span>Format</span>
                  <span className="text-foreground">
                    {mediaType === "image"
                      ? "Single image link ad"
                      : "Single video link ad"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Audit log</span>
                  <span className="text-foreground">ad.create row written</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3">
          {error && (
            <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-subtle">
              {validationError ?? "Ready to send."}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || Boolean(validationError)}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {submitting
                  ? mediaType === "image" && imageSource === "upload"
                    ? "Uploading…"
                    : "Creating…"
                  : status === "PAUSED"
                    ? "Create paused ad"
                    : "Create active ad"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Image picker ──────────────────────────────────────────────────────────
// A selectable grid of the account's synced library images. Unlike videos,
// library images are always usable (they already carry a hash), so there's no
// disabled state. Empty state points at the Image library.
interface ImagePickerProps {
  images: LibraryImage[];
  loading: boolean;
  error: string | null;
  selectedHash: string | null;
  onSelect: (hash: string) => void;
  disabled: boolean;
}

function ImagePicker({
  images,
  loading,
  error,
  selectedHash,
  onSelect,
  disabled,
}: ImagePickerProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border bg-surface px-4 py-8 text-xs text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading library images…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
        {error}
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center text-xs text-muted">
        <ImagePlus className="h-5 w-5 text-subtle" />
        <span>No images in this account&apos;s library yet.</span>
        <span className="text-[10px] text-subtle">
          Upload one (switch to{" "}
          <span className="font-medium text-foreground">Upload new</span>) or
          sync the{" "}
          <a
            href="/dashboard/images"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Image library
          </a>
          .
        </span>
      </div>
    );
  }

  return (
    <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-0.5">
      {images.map((img) => {
        const selected = img.hash === selectedHash;
        return (
          <button
            key={img.hash}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(img.hash)}
            title={img.name ?? img.hash}
            className={cn(
              "group relative aspect-square overflow-hidden rounded-md border transition-colors",
              selected
                ? "border-accent ring-1 ring-accent"
                : "border-border hover:border-accent/60",
            )}
          >
            {img.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img.url}
                alt={img.name ?? img.hash}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-surface-2 text-subtle">
                <ImagePlus className="h-5 w-5" />
              </div>
            )}
            {selected && (
              <div className="absolute right-1 top-1 rounded-full bg-accent p-0.5 text-accent-foreground">
                <Check className="h-3 w-3" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Video upload panel ──────────────────────────────────────────────────────
// Chunk-uploads a new video, then polls Meta until it's `ready` with a poster
// (an ad creative can't reference a video until then). Once ready it lifts the
// video up via onUploaded so the parent can select it. Unlike images, this is
// inherently a two-step wait — Meta encodes after the bytes land.
interface VideoUploadPanelProps {
  metaAdAccountId: string;
  disabled: boolean;
  uploadedVideo: LibraryVideo | null;
  onUploaded: (video: LibraryVideo) => void;
  onReset: () => void;
}

function VideoUploadPanel({
  metaAdAccountId,
  disabled,
  uploadedVideo,
  onUploaded,
  onReset,
}: VideoUploadPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState(0);
  const [panelError, setPanelError] = useState<string | null>(null);
  // Set when upload succeeded but Meta is still encoding past our poll window.
  const [pendingVideoId, setPendingVideoId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  async function start() {
    if (!file || busy) return;
    if (!file.type.startsWith("video/")) {
      setPanelError("That file isn't a video.");
      return;
    }
    setBusy(true);
    setPanelError(null);
    setPendingVideoId(null);
    setProgress(0);
    try {
      const { videoId } = await uploadVideoChunked(file, metaAdAccountId, {
        title: file.name,
        onPhase: setPhase,
        onProgress: setProgress,
      });
      if (cancelledRef.current) return;
      setPhase("Processing on Meta…");
      const status = await pollVideoUntilReady(videoId, metaAdAccountId, {
        onTick: (s) => {
          if (!cancelledRef.current && s.status) {
            setPhase(`Processing on Meta… (${s.status.toLowerCase()})`);
          }
        },
      });
      if (cancelledRef.current) return;
      const ready =
        (!status.status || status.status.toLowerCase() === "ready") &&
        Boolean(status.thumbnailUrl);
      if (ready) {
        onUploaded({
          videoId,
          title: status.title ?? file.name,
          thumbnailUrl: status.thumbnailUrl,
          status: "ready",
          lengthSeconds: status.lengthSeconds,
        });
      } else {
        setPendingVideoId(videoId);
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setPanelError(err instanceof Error ? err.message : "Upload failed");
      }
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  // Re-check a video that was still encoding when the poll window elapsed.
  async function recheck() {
    if (!pendingVideoId || busy) return;
    setBusy(true);
    setPanelError(null);
    setPhase("Checking…");
    try {
      const status = await pollVideoUntilReady(pendingVideoId, metaAdAccountId, {
        timeoutMs: 30_000,
      });
      if (cancelledRef.current) return;
      const ready =
        (!status.status || status.status.toLowerCase() === "ready") &&
        Boolean(status.thumbnailUrl);
      if (ready) {
        onUploaded({
          videoId: pendingVideoId,
          title: status.title ?? file?.name ?? "Uploaded video",
          thumbnailUrl: status.thumbnailUrl,
          status: "ready",
          lengthSeconds: status.lengthSeconds,
        });
        setPendingVideoId(null);
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setPanelError(err instanceof Error ? err.message : "Check failed");
      }
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  // Ready: show the selected poster + a Replace affordance.
  if (uploadedVideo) {
    return (
      <div className="space-y-2">
        <div className="relative overflow-hidden rounded-md border border-accent ring-1 ring-accent">
          <div className="relative aspect-video w-full bg-surface-2">
            {uploadedVideo.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={uploadedVideo.thumbnailUrl}
                alt={uploadedVideo.title ?? uploadedVideo.videoId}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-subtle">
                <VideoIcon className="h-8 w-8" />
              </div>
            )}
            <div className="absolute right-1 top-1 rounded-full bg-accent p-0.5 text-accent-foreground">
              <Check className="h-3 w-3" />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between text-[11px] text-subtle">
          <span className="truncate">
            Uploaded &amp; ready · {uploadedVideo.title ?? uploadedVideo.videoId}
          </span>
          <button
            type="button"
            onClick={() => {
              onReset();
              setFile(null);
              if (fileRef.current) fileRef.current.value = "";
            }}
            disabled={disabled}
            className="ml-2 shrink-0 rounded border border-border bg-background px-2 py-0.5 hover:bg-surface-2"
          >
            Replace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setPanelError(null);
          setPendingVideoId(null);
        }}
        disabled={disabled || busy}
        className="block w-full text-xs text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-surface-2"
      />

      {busy && (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-subtle">
            <span>{phase}</span>
            <span className="tabular-nums">{progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {pendingVideoId && !busy && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Uploaded, but Meta is still encoding. Give it a moment and{" "}
          <button
            type="button"
            onClick={recheck}
            className="font-medium underline hover:no-underline"
          >
            check again
          </button>
          , or switch to <span className="font-medium">From library</span> after
          a Sync.
        </div>
      )}

      {panelError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-danger">
          {panelError}
        </div>
      )}

      {!busy && (
        <button
          type="button"
          onClick={start}
          disabled={disabled || !file}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <UploadCloud className="h-3.5 w-3.5" />
          Upload &amp; use
        </button>
      )}
      <p className="text-[10px] text-subtle">
        Uploaded in chunks through our server. Meta encodes after upload — this
        can take up to a minute before the video is usable.
      </p>
    </div>
  );
}

// ── Video picker ──────────────────────────────────────────────────────────
// A compact, selectable grid of the account's library videos. Anything not
// yet usable (still processing, or missing a poster Meta requires) renders
// dimmed and non-selectable with a short reason. Empty state points the user
// at the Video library, since that's where videos are uploaded.
interface VideoPickerProps {
  videos: LibraryVideo[];
  loading: boolean;
  error: string | null;
  selectedVideoId: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
}

function VideoPicker({
  videos,
  loading,
  error,
  selectedVideoId,
  onSelect,
  disabled,
}: VideoPickerProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border bg-surface px-4 py-8 text-xs text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading library videos…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
        {error}
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center text-xs text-muted">
        <VideoIcon className="h-5 w-5 text-subtle" />
        <span>No videos in this account&apos;s library yet.</span>
        <span className="text-[10px] text-subtle">
          Upload one in{" "}
          <a
            href="/dashboard/videos"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Video library
          </a>{" "}
          and Sync, then it&apos;ll appear here.
        </span>
      </div>
    );
  }

  return (
    <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-0.5">
      {videos.map((v) => {
        const usable = isVideoUsable(v);
        const selected = v.videoId === selectedVideoId;
        const length = formatLength(v.lengthSeconds);
        const reason = !v.thumbnailUrl
          ? "No poster — re-sync"
          : v.status && v.status.toLowerCase() !== "ready"
            ? "Processing"
            : null;
        return (
          <button
            key={v.videoId}
            type="button"
            disabled={disabled || !usable}
            onClick={() => usable && onSelect(v.videoId)}
            title={v.title ?? v.videoId}
            className={cn(
              "group relative overflow-hidden rounded-md border text-left transition-colors",
              selected
                ? "border-accent ring-1 ring-accent"
                : "border-border hover:border-accent/60",
              !usable && "cursor-not-allowed opacity-50",
            )}
          >
            <div className="relative aspect-video w-full bg-surface-2">
              {v.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={v.thumbnailUrl}
                  alt={v.title ?? v.videoId}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-subtle">
                  <VideoIcon className="h-6 w-6" />
                </div>
              )}
              {selected && (
                <div className="absolute right-1 top-1 rounded-full bg-accent p-0.5 text-accent-foreground">
                  <Check className="h-3 w-3" />
                </div>
              )}
              {length && (
                <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 font-mono text-[9px] font-medium text-white">
                  {length}
                </span>
              )}
              {reason && (
                <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-medium text-white">
                  {reason}
                </span>
              )}
            </div>
            <div className="px-1.5 py-1">
              <p className="line-clamp-1 text-[11px] font-medium text-foreground">
                {v.title ?? "Untitled video"}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
