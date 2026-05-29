"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Image as ImageIcon, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Create a standalone, reusable ad creative (image + link + copy + CTA).
 * Page and image both lazy-load per account so the user picks from
 * dropdowns/thumbnails instead of hunting for IDs. Right pane shows the
 * exact object_story_spec that hits Meta.
 *
 * This is the image-link creative — the common case. Video creatives are a
 * later addition (they depend on video upload, which is parked).
 */

export interface CreativeAccountOption {
  metaAdAccountId: string; // act_-prefixed
  name: string;
  businessName: string;
}

interface CreateCreativeModalProps {
  open: boolean;
  accounts: CreativeAccountOption[];
  onClose: () => void;
}

interface PageOption {
  id: string;
  name: string;
}

interface ImageOption {
  hash: string;
  url: string | null;
  name: string | null;
  width: number | null;
  height: number | null;
}

const CTA_OPTIONS = [
  { value: "SHOP_NOW", label: "Shop now" },
  { value: "LEARN_MORE", label: "Learn more" },
  { value: "SIGN_UP", label: "Sign up" },
  { value: "BOOK_TRAVEL", label: "Book now" },
  { value: "DOWNLOAD", label: "Download" },
  { value: "GET_QUOTE", label: "Get quote" },
  { value: "CONTACT_US", label: "Contact us" },
  { value: "APPLY_NOW", label: "Apply now" },
  { value: "SUBSCRIBE", label: "Subscribe" },
  { value: "GET_OFFER", label: "Get offer" },
  { value: "ORDER_NOW", label: "Order now" },
  { value: "WATCH_MORE", label: "Watch more" },
];

export function CreateCreativeModal({
  open,
  accounts,
  onClose,
}: CreateCreativeModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [accountId, setAccountId] = useState(
    accounts[0]?.metaAdAccountId ?? "",
  );
  const [name, setName] = useState("");
  const [pageId, setPageId] = useState("");
  const [imageHash, setImageHash] = useState("");
  const [message, setMessage] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [cta, setCta] = useState("LEARN_MORE");

  const [pages, setPages] = useState<PageOption[] | null>(null);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);

  const [images, setImages] = useState<ImageOption[] | null>(null);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesError, setImagesError] = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLSelectElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setAccountId(accounts[0]?.metaAdAccountId ?? "");
    setName("");
    setPageId("");
    setImageHash("");
    setMessage("");
    setHeadline("");
    setDescription("");
    setLinkUrl("");
    setCta("LEARN_MORE");
    setError(null);
  }, [open, accounts]);

  // Lazy-load pages + images whenever the account changes.
  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;

    setPagesLoading(true);
    setPagesError(null);
    setPages(null);
    fetch(`/api/pages?accountId=${encodeURIComponent(accountId)}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          pages?: PageOption[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setPagesError(data.error ?? `HTTP ${res.status}`);
          setPages([]);
          return;
        }
        setPages(data.pages ?? []);
        if (data.pages && data.pages.length > 0) setPageId(data.pages[0].id);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPagesError(err instanceof Error ? err.message : "Failed");
        setPages([]);
      })
      .finally(() => {
        if (!cancelled) setPagesLoading(false);
      });

    setImagesLoading(true);
    setImagesError(null);
    setImages(null);
    fetch(`/api/images?accountId=${encodeURIComponent(accountId)}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          images?: ImageOption[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setImagesError(data.error ?? `HTTP ${res.status}`);
          setImages([]);
          return;
        }
        setImages(data.images ?? []);
        if (data.images && data.images.length > 0) {
          setImageHash(data.images[0].hash);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setImagesError(err instanceof Error ? err.message : "Failed");
        setImages([]);
      })
      .finally(() => {
        if (!cancelled) setImagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, accountId]);

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

  const selectedImage = useMemo(
    () => images?.find((i) => i.hash === imageHash) ?? null,
    [images, imageHash],
  );

  const validationError = (() => {
    if (!accountId) return "Pick an ad account.";
    if (pages && pages.length === 0) return "This account has no pages.";
    if (!pageId) return "Pick a Facebook Page.";
    if (images && images.length === 0)
      return "No images synced — sync images first.";
    if (!imageHash) return "Pick an image.";
    if (!linkUrl.trim()) return "Enter a website URL.";
    if (!/^https?:\/\//i.test(linkUrl.trim()))
      return "URL must start with http:// or https://";
    return null;
  })();

  async function submit() {
    if (validationError) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/creatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metaAdAccountId: accountId,
          name: name.trim() || undefined,
          pageId,
          imageHash,
          message: message.trim() || undefined,
          headline: headline.trim() || undefined,
          description: description.trim() || undefined,
          linkUrl: linkUrl.trim(),
          callToActionType: cta,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create creative");
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted || !open) return null;

  const previewPayload = {
    name: name.trim() || "(auto-named by Meta)",
    object_story_spec: {
      page_id: pageId || "(pick a page)",
      link_data: {
        link: linkUrl.trim() || "(url)",
        image_hash: imageHash || "(pick an image)",
        message: message.trim() || undefined,
        name: headline.trim() || undefined,
        description: description.trim() || undefined,
        call_to_action: { type: cta, value: { link: linkUrl.trim() || "(url)" } },
      },
    },
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-creative-title"
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-background shadow-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h2
              id="create-creative-title"
              className="text-sm font-semibold tracking-tight"
            >
              New creative
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              A reusable image creative — page post with image, copy, link and
              a call-to-action.
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
            {/* Form */}
            <div className="space-y-4 border-b border-border px-5 py-4 lg:border-b-0 lg:border-r">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Ad account <span className="text-danger">*</span>
                </label>
                <select
                  ref={firstFieldRef}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  disabled={submitting || accounts.length === 0}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {accounts.length === 0 && (
                    <option value="">No accounts available</option>
                  )}
                  {accounts.map((a) => (
                    <option key={a.metaAdAccountId} value={a.metaAdAccountId}>
                      {a.businessName} · {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Facebook Page <span className="text-danger">*</span>
                </label>
                {pagesLoading ? (
                  <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading pages…
                  </p>
                ) : pagesError ? (
                  <p className="text-xs text-danger">{pagesError}</p>
                ) : pages && pages.length > 0 ? (
                  <select
                    value={pageId}
                    onChange={(e) => setPageId(e.target.value)}
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {pages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.id})
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="rounded-md border border-dashed border-border bg-surface px-3 py-2 text-[11px] text-muted">
                    No promotable pages on this account. Assign a Page to the
                    System User (setup guide step 6).
                  </p>
                )}
              </div>

              {/* Image picker */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Image <span className="text-danger">*</span>
                </label>
                {imagesLoading ? (
                  <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading images…
                  </p>
                ) : imagesError ? (
                  <p className="text-xs text-danger">{imagesError}</p>
                ) : images && images.length > 0 ? (
                  <div className="flex items-center gap-3">
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded ring-1 ring-border">
                      {selectedImage?.url ? (
                        <Image
                          src={selectedImage.url}
                          alt={selectedImage.name ?? imageHash}
                          fill
                          sizes="64px"
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-surface-2 text-subtle">
                          <ImageIcon className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <select
                      value={imageHash}
                      onChange={(e) => setImageHash(e.target.value)}
                      disabled={submitting}
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      {images.map((img) => (
                        <option key={img.hash} value={img.hash}>
                          {img.name ?? img.hash.slice(0, 12)}
                          {img.width && img.height
                            ? ` · ${img.width}×${img.height}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed border-border bg-surface px-3 py-2 text-[11px] text-muted">
                    No images synced for this account. Sync the Image library
                    first, then pick one here.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Primary text
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={2}
                  placeholder="The main caption shown above the image"
                  disabled={submitting}
                  className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    Headline
                  </label>
                  <input
                    type="text"
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    placeholder="Bold one-liner"
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    Call to action
                  </label>
                  <select
                    value={cta}
                    onChange={(e) => setCta(e.target.value)}
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {CTA_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Website URL <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://example.com/landing"
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Creative name (optional)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Meta auto-names if left blank"
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            {/* Preview */}
            <div className="bg-surface px-5 py-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">
                Meta payload
              </div>
              <p className="mt-0.5 text-[11px] text-subtle">
                Hits{" "}
                <span className="font-mono">POST /act_*/adcreatives</span>.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-background p-3 text-[11px] leading-relaxed text-foreground">
                {JSON.stringify(previewPayload, null, 2)}
              </pre>
              <div className="mt-3 text-[11px] text-subtle">
                Audit log: creative.create row written. The new creative is
                reusable across ads (swap it in via Edit ad).
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
              {validationError ?? "Ready to create."}
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
                {submitting ? "Creating…" : "Create creative"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
