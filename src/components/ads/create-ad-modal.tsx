"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, ImagePlus, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ParentAdSet {
  metaAdSetId: string;
  name: string;
}

interface CreateAdModalProps {
  open: boolean;
  adSet: ParentAdSet;
  onClose: () => void;
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

export function CreateAdModal({ open, adSet, onClose }: CreateAdModalProps) {
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

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
    setImageFile(null);
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setShowAdvanced(false);
    setError(null);
  }, [open]);

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
    if (!imageFile) return "Pick an image to upload.";
    return null;
  })();

  // ── Live preview payload (image shown as a placeholder reference) ─────
  const previewLinkData: Record<string, unknown> = {
    link: link || "(empty)",
    message: message || "(empty)",
    name: headline || "(empty)",
    image_hash: imageFile ? `[uploaded — ${imageFile.name}]` : "(no image)",
    call_to_action: {
      type: callToAction,
      value: { link: link || "(empty)" },
    },
  };
  if (description.trim()) previewLinkData.description = description.trim();

  const previewObjectStorySpec: Record<string, unknown> = {
    page_id: pageId || "(empty)",
    link_data: previewLinkData,
  };
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
    if (validationError || !imageFile) return;
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("metaAdSetId", adSet.metaAdSetId);
      form.set("name", name.trim());
      form.set("status", status);
      form.set("pageId", pageId.trim());
      if (instagramActorId.trim()) {
        form.set("instagramActorId", instagramActorId.trim());
      }
      form.set("link", link.trim());
      form.set("message", message.trim());
      form.set("headline", headline.trim());
      if (description.trim()) form.set("description", description.trim());
      form.set("callToAction", callToAction);
      form.set("image", imageFile, imageFile.name);

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
              default. Single image link ad.
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
                <div className="text-xs font-semibold text-foreground">
                  Media <span className="text-danger">*</span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
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
                      <span className="truncate">{imageFile?.name}</span>
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
                      JPG / PNG · up to {MAX_IMAGE_BYTES / 1024 / 1024} MB · 1080×1080+ recommended
                    </span>
                  </button>
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
                Image is uploaded first (
                <span className="font-mono">POST /act_*/adimages</span>) to get
                a hash, then the ad is created (
                <span className="font-mono">POST /act_*/ads</span>) referencing
                that hash.
              </p>
              <pre className="mt-3 max-h-[40vh] overflow-auto rounded-md border border-border bg-background p-3 text-[11px] leading-relaxed text-foreground">
                {JSON.stringify(previewPayload, null, 2)}
              </pre>
              <div className="mt-3 space-y-1 text-[11px] text-subtle">
                <div className="flex justify-between">
                  <span>Format</span>
                  <span className="text-foreground">Single image link ad</span>
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
                  ? "Uploading…"
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
