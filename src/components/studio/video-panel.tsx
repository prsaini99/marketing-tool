"use client";

import { useEffect, useRef, useState } from "react";
import { Film, Loader2 } from "lucide-react";
import {
  VIDEO_FORMATS,
  getVideoFormat,
  aspectForPlacement,
} from "@/server/services/ai/video-formats";
import type {
  StudioBrand,
  StudioToggles,
} from "@/server/services/ai/studio-prompt";
import type { BrandContext } from "@/server/services/ai/ad-copy";
import { cn } from "@/lib/utils";

/**
 * The video half of Ad Studio's Still/Video switch, in three pieces:
 *
 *   useVideoJob   — all of the state: the format choice, the live job,
 *                   starting, polling, resuming and the per-scope history.
 *   VideoControls — the inputs, which live in the 380px control rail.
 *   VideoResults  — the output, which lives on the results canvas beside it,
 *                   because a 9:16 clip in a 380px column is unreadable.
 *
 * Brief, placement, brand kit and its toggles are lifted state owned by
 * StudioClient — this reads them and sends them along on generate, exactly
 * like the still-image path does.
 *
 * Talks to POST /api/ai/ad-video/generate and GET /api/ai/ad-video[/id].
 * No third module calls Higgsfield directly; this only ever calls routes.
 */

type JobStatus = "QUEUED" | "RUNNING" | "READY" | "FAILED" | string;

interface VideoJob {
  id: string;
  status: JobStatus;
  error: string | null;
  videoUrl: string | null;
  expiresSoon: boolean;
  aspectRatio: string;
  formatId: string;
  createdAt: string;
}

const POLL_MS = 5000;
const TICK_MS = 1000;

function isTerminal(status: string) {
  return status !== "QUEUED" && status !== "RUNNING";
}

/**
 * Rows worth asking the server about. Non-terminal ones obviously — but also
 * a READY row we never managed to store, which is a paid clip living on a
 * vendor URL that dies in about a week: advancing it retries the copy.
 *
 * `expiresSoon` is the test, not `!videoUrl`. toPublic already computes
 * exactly "READY but not stored" and answers it with the vendor URL, so a
 * store-failed row HAS a videoUrl — keying off its absence selected only
 * rows with no URL at all, which are the ones the server can do nothing
 * for. The two conditions were disjoint and the retry fired for nothing.
 * Re-deriving the condition here would just be a second thing to keep in
 * sync with toPublic.
 */
function needsAdvance(job: VideoJob) {
  if (!isTerminal(job.status)) return true;
  return job.status === "READY" && (!job.videoUrl || job.expiresSoon);
}

function storageKey(businessId: string | null) {
  return `studio-video-job:${businessId ?? "workspace"}`;
}

function readStoredJobId(businessId: string | null): string | null {
  try {
    return localStorage.getItem(storageKey(businessId));
  } catch {
    // Throws outright in some contexts (locked-down storage, some private
    // windows) — no stored job just means nothing to resume.
    return null;
  }
}

function writeStoredJobId(businessId: string | null, id: string) {
  try {
    localStorage.setItem(storageKey(businessId), id);
  } catch {
    // Best-effort only: this session simply won't remember which job the
    // canvas was showing. The list-route sweep below still finds it.
  }
}

function clearStoredJobId(businessId: string | null) {
  try {
    localStorage.removeItem(storageKey(businessId));
  } catch {
    // Nothing to clean up if the read/write never landed anyway.
  }
}

// Video has no 4:5, so this is always one of 1:1 or 9:16 (see
// aspectForPlacement), but parsed generically rather than hard-coded.
function aspectStyle(aspectRatio: string): { aspectRatio: string } | undefined {
  const [w, h] = aspectRatio.split(":").map(Number);
  if (!w || !h) return undefined;
  return { aspectRatio: `${w} / ${h}` };
}

// Distinguishes "the row is genuinely gone" (404 — stop tracking it) from
// "the status check itself failed" (any other non-2xx, or a thrown fetch —
// e.g. advanceVideoGeneration's own upstream call to Higgsfield hiccuping).
// The latter must never be treated as job-gone: it would drop the pointer
// to a running, already-paid-for job over a transient blip.
type FetchJobResult =
  | { kind: "ok"; job: VideoJob }
  | { kind: "not_found" }
  | { kind: "transient" };

async function fetchJob(
  id: string,
  businessId: string | null,
): Promise<FetchJobResult> {
  try {
    // The scope goes with the id: the route folds an absent client to the
    // workspace and filters on it, so asking without it would 404 a client's
    // job rather than return someone else's.
    const qs = businessId ? `?client=${encodeURIComponent(businessId)}` : "";
    const res = await fetch(`/api/ai/ad-video/${id}${qs}`);
    if (res.status === 404) return { kind: "not_found" };
    if (!res.ok) return { kind: "transient" };
    return { kind: "ok", job: (await res.json()) as VideoJob };
  } catch {
    return { kind: "transient" };
  }
}

// After this many consecutive failed status checks (15s at the 5s poll
// interval), stop polling silently and say something — one or two misses
// is normal network noise and not worth alarming the operator over, but a
// run this long is a real pattern they should know about, especially since
// polling and the stored job id both keep going regardless.
const TRANSIENT_FAILURE_THRESHOLD = 3;

interface UseVideoJobArgs {
  /** False while the studio is in Still mode: no fetching, no polling. */
  enabled: boolean;
  businessId: string | null;
  brief: string;
  placementId: string;
  brand: StudioBrand | null;
  toggles: StudioToggles;
  context: BrandContext | null;
}

export interface VideoJobState {
  formatId: string;
  setFormatId: (id: string) => void;
  format: ReturnType<typeof getVideoFormat>;
  placementNote: string | null;
  job: VideoJob | null;
  history: VideoJob[];
  error: string | null;
  statusWarning: string | null;
  starting: boolean;
  live: boolean;
  elapsed: number;
  canGenerate: boolean;
  generate: () => void;
}

export function useVideoJob(args: UseVideoJobArgs): VideoJobState {
  const { enabled, businessId, brief, placementId } = args;

  const [formatId, setFormatId] = useState(VIDEO_FORMATS[0]?.id ?? "");
  const format = getVideoFormat(formatId);
  const { aspectRatio: placementAspect, note } = aspectForPlacement(placementId);

  const [job, setJob] = useState<VideoJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [history, setHistory] = useState<VideoJob[]>([]);
  // Non-fatal: status checks are failing but polling continues. Distinct
  // from `error`, which is a generate-call failure with no live job.
  const [statusWarning, setStatusWarning] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failCountRef = useRef(0);
  // Every job this browser is currently advancing — not just the one in
  // localStorage. A lost 202 (tab closed mid-request, a dropped network, or
  // the operator moving to a second device) used to leave a charged row that
  // nothing would ever poll: QUEUED in the strip forever, bytes never copied,
  // and Higgsfield deleting the file after about a week.
  const pendingRef = useRef<Set<string>>(new Set());
  // One sweep at a time. The tick awaits each id in turn and the status route
  // calls Higgsfield, so a slow sweep can outlast POLL_MS — without this,
  // two sweeps advance the same row at once: duplicate vendor status calls,
  // and on the READY tick two downloads racing to the same storage path.
  const sweepingRef = useRef(false);
  // Which job the canvas is showing, read inside the interval without
  // making the interval depend on it.
  const focusIdRef = useRef<string | null>(null);
  // The latest brief/brand/toggles, so generate() sends what is on screen
  // now without the polling effects re-running on every keystroke.
  const argsRef = useRef(args);
  useEffect(() => {
    argsRef.current = args;
  });

  const live = job !== null && !isTerminal(job.status);

  function clearPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function focus(next: VideoJob | null) {
    focusIdRef.current = next?.id ?? null;
    setJob(next);
  }

  function mergeHistory(next: VideoJob) {
    setHistory((prev) => {
      if (prev.some((h) => h.id === next.id)) {
        return prev.map((h) => (h.id === next.id ? next : h));
      }
      // A resumed job can be older than everything on the strip (it came from
      // the pending query, which ignores the twelve-row cap), so this sorts
      // rather than prepending.
      return [next, ...prev]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 12);
    });
  }

  function startPolling(biz: string | null) {
    if (pollRef.current || pendingRef.current.size === 0) return;
    pollRef.current = setInterval(async () => {
      if (sweepingRef.current) return;
      const ids = [...pendingRef.current];
      if (ids.length === 0) {
        clearPoll();
        return;
      }
      sweepingRef.current = true;
      let sawTransient = false;
      try {
        for (const id of ids) {
          const result = await fetchJob(id, biz);
          if (result.kind === "not_found") {
            // The row is actually gone — stop rather than spin forever, and
            // drop the stale pointer.
            pendingRef.current.delete(id);
            if (focusIdRef.current === id) clearStoredJobId(biz);
            continue;
          }
          if (result.kind === "transient") {
            // The status check itself failed, not the job. Keep polling and
            // keep the id — the next tick may well succeed.
            sawTransient = true;
            continue;
          }
          mergeHistory(result.job);
          if (focusIdRef.current === result.job.id) setJob(result.job);
          if (isTerminal(result.job.status)) {
            pendingRef.current.delete(id);
            if (focusIdRef.current === id) clearStoredJobId(biz);
          }
        }
        if (sawTransient) {
          // Say something once the run of failures is long enough to be a real
          // pattern rather than one flaky request.
          failCountRef.current += 1;
          if (failCountRef.current >= TRANSIENT_FAILURE_THRESHOLD) {
            setStatusWarning(
              "Status checks are failing — still polling. The job itself may still be running fine.",
            );
          }
        } else {
          failCountRef.current = 0;
          setStatusWarning(null);
        }
        if (pendingRef.current.size === 0) clearPoll();
      } finally {
        sweepingRef.current = false;
      }
    }, POLL_MS);
  }

  // ── Mount / scope change: load the scope's jobs and resume every live one ─
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    clearPoll();
    pendingRef.current = new Set();
    focus(null);
    setError(null);
    setStatusWarning(null);
    failCountRef.current = 0;

    (async () => {
      let rows: VideoJob[] = [];
      let pending: VideoJob[] = [];
      try {
        const qs = businessId
          ? `?client=${encodeURIComponent(businessId)}`
          : "";
        const res = await fetch(`/api/ai/ad-video${qs}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.generations)) rows = data.generations;
          if (Array.isArray(data?.pending)) pending = data.pending;
        }
      } catch {
        // The list is a convenience; a failed fetch just leaves the strip
        // empty. The localStorage fast path below still resumes the job
        // this browser started.
      }
      if (cancelled) return;
      setHistory(rows);

      // Resume ANY row that still has work outstanding, not only the one in
      // localStorage — that key is per-browser, and a job it never recorded
      // is still a job that was paid for. One advance call each: it polls
      // the vendor, and for a READY row with no stored file it retries the
      // copy. The list route reads raw, so this is the only thing that can
      // move those rows forward.
      const storedId = readStoredJobId(businessId);
      // `pending` is every non-terminal row for the scope, however old — the
      // history strip only carries twelve, and a job stuck QUEUED that twelve
      // later generations pushed off it is exactly the one nobody else would
      // ever poll. `rows.filter(needsAdvance)` adds the store retries, which
      // are terminal and so never appear in `pending`.
      const ids = new Set([
        ...pending.map((r) => r.id),
        ...rows.filter(needsAdvance).map((r) => r.id),
      ]);
      // The stored id may name a job older than either list.
      if (storedId) ids.add(storedId);

      const advanced = await Promise.all(
        [...ids].map(async (id) => ({ id, result: await fetchJob(id, businessId) })),
      );
      if (cancelled) return;

      const alive: VideoJob[] = [];
      for (const { id, result } of advanced) {
        if (result.kind === "not_found") {
          if (id === storedId) clearStoredJobId(businessId);
          setHistory((prev) => prev.filter((h) => h.id !== id));
          continue;
        }
        if (result.kind === "transient") {
          // Unknown whether it's still live — keep polling it; the first
          // successful tick will say. A blip on this very first check
          // shouldn't drop tracking of a paid job.
          pendingRef.current.add(id);
          continue;
        }
        mergeHistory(result.job);
        if (!isTerminal(result.job.status)) {
          pendingRef.current.add(id);
          alive.push(result.job);
        }
      }

      // The canvas shows the job this browser started if it is still going;
      // otherwise the newest live one from any device.
      const stored = alive.find((j) => j.id === storedId);
      const newest = [...alive].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )[0];
      const showing = stored ?? newest ?? null;
      if (showing) {
        focus(showing);
        setNow(Date.now());
      }
      if (storedId && !stored) clearStoredJobId(businessId);

      startPolling(businessId);
    })();

    return () => {
      cancelled = true;
      clearPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, enabled]);

  // ── Elapsed-seconds ticker, only while a job is actually live ────────
  useEffect(() => {
    if (!live) return;
    tickRef.current = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [live]);

  const elapsed = job
    ? Math.max(0, Math.floor((now - new Date(job.createdAt).getTime()) / 1000))
    : 0;

  const canGenerate = Boolean(format) && brief.trim().length > 0;

  async function generate() {
    if (live || starting || !canGenerate) return;
    setStarting(true);
    setError(null);
    setStatusWarning(null);
    failCountRef.current = 0;
    const current = argsRef.current;
    try {
      const res = await fetch("/api/ai/ad-video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: current.businessId,
          formatId,
          brief: current.brief.trim(),
          placement: current.placementId,
          brand: current.brand,
          toggles: current.toggles,
          brandContext: current.context,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const newJob: VideoJob = {
        id: data.id,
        status: "QUEUED",
        error: null,
        videoUrl: null,
        expiresSoon: false,
        aspectRatio: placementAspect,
        formatId,
        createdAt: new Date().toISOString(),
      };
      focus(newJob);
      mergeHistory(newJob);
      setNow(Date.now());
      writeStoredJobId(businessId, newJob.id);
      pendingRef.current.add(newJob.id);
      startPolling(businessId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Video generation failed");
    } finally {
      setStarting(false);
    }
  }

  return {
    formatId,
    setFormatId,
    format,
    placementNote: note,
    job,
    history,
    error,
    statusWarning,
    starting,
    live,
    elapsed,
    canGenerate,
    generate,
  };
}

/** The rail half: what the operator sets before spending a credit. */
export function VideoControls({ video }: { video: VideoJobState }) {
  const { format, placementNote } = video;
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">
          Video format
        </label>
        <select
          value={video.formatId}
          onChange={(e) => video.setFormatId(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {VIDEO_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {format && (
          <div className="space-y-0.5 text-[11px] text-muted">
            <p>{format.anatomy}</p>
            <p>Watch out: {format.failureMode}</p>
          </div>
        )}
      </div>

      {placementNote && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {placementNote}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-subtle">
          Five-second clip, no on-screen text — put copy in Meta&rsquo;s own
          text fields.
        </p>
        <button
          type="button"
          onClick={video.generate}
          disabled={video.live || video.starting || !video.canGenerate}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {video.starting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {video.starting ? "Starting…" : "Generate"}
        </button>
      </div>

      {video.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
          {video.error}
        </div>
      )}
    </div>
  );
}

/**
 * The canvas half: the live job, the finished clip, and the strip of what
 * this scope has already paid for. Sized like the still results card so the
 * two modes read as one tool.
 */
export function VideoResults({ video }: { video: VideoJobState }) {
  const { job, history } = video;

  if (!job && history.length === 0) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-surface px-6 text-center">
        <Film className="h-6 w-6 text-subtle" />
        <p className="mt-2 text-sm font-medium text-foreground">
          Nothing generated yet
        </p>
        <p className="mt-1 max-w-xs text-xs text-muted">
          Pick a video format, describe the ad on the left and hit Generate.
          Clips take a few minutes and are kept here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-background p-4">
      <h2 className="text-sm font-semibold text-foreground">Results</h2>

      {video.statusWarning && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {video.statusWarning}
        </div>
      )}

      {job && !isTerminal(job.status) && (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-surface px-6 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-subtle" />
          <p className="mt-2 text-sm font-medium text-foreground">
            {job.status === "QUEUED" ? "Queued" : "Rendering"} — {video.elapsed}s
          </p>
          <p className="mt-1 max-w-xs text-xs text-muted">
            This keeps running even if you leave this page — come back and it
            will still be here.
          </p>
        </div>
      )}

      {job && job.status === "READY" && job.videoUrl && (
        <div className="space-y-2">
          <div className="flex justify-center rounded-md bg-surface-2 p-2">
            <video
              controls
              src={job.videoUrl}
              style={aspectStyle(job.aspectRatio)}
              className="max-h-[70vh] w-auto max-w-full rounded-md border border-border bg-black"
            />
          </div>
          {job.expiresSoon && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Rendered, but saving our own copy failed — this is the
              vendor&rsquo;s link and it stops working in about seven days.
              Download it now. Coming back to this page retries the save
              every so often, so the copy may still land on its own; either
              way there is no need to generate (or pay) a second time.
            </div>
          )}
        </div>
      )}

      {job && job.status === "READY" && !job.videoUrl && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          The render finished but no file came back with it. Nothing to play —
          check the server log before spending another credit.
        </div>
      )}

      {job && (job.status === "FAILED" || job.status === "CANCELLED") && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
          {job.error ??
            (job.status === "CANCELLED"
              ? "The render was cancelled."
              : "Video generation failed.")}
        </div>
      )}

      <div className="space-y-1.5 border-t border-border pt-3">
        <label className="text-xs font-medium text-foreground">
          Recent generations
        </label>
        {history.length === 0 ? (
          <p className="text-[11px] text-subtle">Nothing generated yet.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {history.map((h) => (
              <div key={h.id}>
                {h.videoUrl ? (
                  <video
                    src={h.videoUrl}
                    muted
                    loop
                    playsInline
                    style={aspectStyle(h.aspectRatio)}
                    className="w-full rounded-md border border-border bg-black object-cover"
                    onMouseEnter={(e) => {
                      e.currentTarget.play().catch(() => {});
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.pause();
                      e.currentTarget.currentTime = 0;
                    }}
                  />
                ) : (
                  <div
                    className={cn(
                      "flex aspect-square w-full items-center justify-center rounded-md border text-[10px] font-medium",
                      h.status === "FAILED" || h.status === "CANCELLED"
                        ? "border-red-200 bg-red-50 text-danger"
                        : "border-border bg-surface-2 text-muted",
                    )}
                  >
                    {h.status === "FAILED"
                      ? "Failed"
                      : h.status === "CANCELLED"
                        ? "Cancelled"
                        : h.status === "READY"
                          ? "No file"
                          : h.status}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
