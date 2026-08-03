/**
 * Orchestrator — the only engine module that touches the DB or Meta.
 * Loads account/rules/profile/thread, computes guardrail inputs, calls the
 * pure decide(), then executes each planned action audit-first:
 * AutomationLog PENDING row BEFORE the send, SENT/FAILED stamp after.
 *
 * opts.persist=false is the dry-run path: same reads, same decide(), same
 * rendering — but no writes, and sends go to an injected recording Sender
 * instead of Meta. opts.rulesOverride lets the rule editor test an unsaved
 * rule.
 */

import { Prisma, type BotLead, type BotThread } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  getMediaCaption,
  listAdFacebookPosts,
  listAdInstagramMedia,
  replyToComment,
  sendDm,
  sendDmToCommenter,
} from "@/lib/meta/messaging";
import { decide, HUMAN_FALLBACK_TEXT } from "./decide";
import { hasIntent } from "./intent";
import { classifyIntent, type IntentVerdict } from "./intent-guard";
import { matchRuleWithReason } from "./match";
import { isOptOutMessage } from "./opt-out";
import { generateAiReply } from "./ai";
import type { ProfileCorpus } from "./ai-guards";
import {
  AI_HISTORY_LIMIT,
  appendMessages,
  readRecentMessages,
} from "./thread-messages";
import {
  deriveStage,
  EMPTY_LEAD,
  mergeLead,
  type LeadFields,
  type LeadStage,
} from "./lead";
import { pickFlagReason } from "./flags";
import { extractLead } from "./lead-extract";
import type {
  IncomingEvent,
  PlannedAction,
  RuleLike,
} from "./types";

/**
 * Each send method resolves to the Meta message id of what was just sent
 * (or `null` when there isn't one to record) — NOT void. This is what lets
 * a BOT reply's `BotMessage` row carry the same `metaMid` Meta later echoes
 * back, so echo.ts's `recordEcho` can recognise "this echo is our own send"
 * via the `metaMid` unique lookup instead of always treating an unmatched
 * echo as a human reply. Before this, BOT rows never got a `metaMid` at
 * all, so every echo of the bot's own DM looked exactly like an outside
 * human reply and flipped `ownership` to HUMAN after the bot's first
 * message — silently killing automation on that thread.
 */
export interface Sender {
  sendPublicReply(commentId: string, text: string): Promise<string | null>;
  sendCommentDm(commentId: string, text: string): Promise<string | null>;
  sendThreadDm(igsid: string, text: string): Promise<string | null>;
}

export interface OrchestrateOptions {
  sender?: Sender; // default: real Meta sender when persist is true, a no-op sender when persist is false
  persist?: boolean; // default true; false = dry-run
  callAi?: boolean; // default true; false = AI actions return placeholder text
  eventDbId?: string; // pre-created AutomationEvent (webhook dedupe path)
  rulesOverride?: RuleLike[]; // replaces DB rules (dry-run of an unsaved rule)
}

export type ActionOutcome = PlannedAction & {
  status: "SENT" | "FAILED" | "SKIPPED" | "PLANNED";
  metaError?: string;
  /** Meta message id returned by the send, when there is one to record. */
  metaMid?: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DM_ACTIONS = ["DM", "AI_DM", "DM_VIA_COMMENT", "AI_DM_VIA_COMMENT"];
const PUBLIC_REPLY_ACTIONS = ["PUBLIC_REPLY", "AI_PUBLIC_REPLY"];

/**
 * All three sends are Page-scoped on the Facebook-Login flow: Meta rejects
 * the IG-user-id endpoints (#3 / #100) and the system-user token (#190).
 * `pageId` is SocialAccount.linkedPageId, captured at discovery; a null
 * value means the Page linkage was never recorded, so sends cannot work —
 * fail loudly rather than calling Meta with "null" in the path.
 */
function makeMetaSender(
  connectionId: string,
  pageId: string | null,
  // Needed because the public-reply edge is platform-specific — see
  // replyToComment. Everything else on this surface is Page-scoped and
  // identical for both platforms, which is why only this one call takes it.
  platform: "INSTAGRAM" | "FACEBOOK",
): Sender {
  function requirePageId(): string {
    if (!pageId) {
      throw new Error(
        "No linked Facebook Page for this account — re-run Discover so the Page linkage is recorded.",
      );
    }
    return pageId;
  }
  return {
    // replyToComment resolves { id }, a COMMENT id — a different Meta id
    // namespace than a DM message mid. `BotMessage.metaMid` is @unique
    // across the whole table and echo reconciliation (echo.ts) only ever
    // looks at MESSAGE-type echoes (route.ts filters echoes on
    // `e.type === "MESSAGE"` before calling recordEcho), so a comment id
    // would never be looked up there anyway. Returning it as a metaMid
    // would buy nothing and risks an unrelated comment id colliding with a
    // real message mid on that shared unique column. Deliberately discard
    // it and return null.
    sendPublicReply: async (commentId, text) => {
      await replyToComment(
        connectionId,
        requirePageId(),
        commentId,
        text,
        platform,
      );
      return null;
    },
    sendCommentDm: async (commentId, text) => {
      const res = await sendDmToCommenter(
        connectionId,
        requirePageId(),
        commentId,
        text,
      );
      return res.messageId;
    },
    sendThreadDm: async (igsid, text) => {
      const res = await sendDm(connectionId, requirePageId(), igsid, text);
      return res.messageId;
    },
  };
}

/**
 * Dry-run guard: when persist=false and the caller injected no Sender, we
 * must NEVER fall through to the real Meta sender. A dry run that sends a
 * live DM is the worst possible failure mode of this module, so the safe
 * sender is the structural default rather than a caller convention.
 */
const NOOP_SENDER: Sender = {
  sendPublicReply: async () => null,
  sendCommentDm: async () => null,
  sendThreadDm: async () => null,
};

/**
 * IG media ids currently attached to ads, across every ad account this
 * connection can see.
 *
 * Cached briefly (not for the process lifetime like captions): ads are
 * paused, created and rotated constantly, so a long cache would leave an
 * "ads only" rule acting on stale information. Failures return an empty set
 * — never throw — because an ad-list problem must not stop the engine from
 * handling the comment.
 */
const AD_MEDIA_TTL_MS = 5 * 60 * 1000;
const adMediaCache = new Map<string, { at: number; ids: Set<string> }>();

async function getAdMediaIds(
  connectionId: string,
  platform: string,
): Promise<Set<string>> {
  const cacheKey = `${connectionId}:${platform}`;
  const hit = adMediaCache.get(cacheKey);
  if (hit && Date.now() - hit.at < AD_MEDIA_TTL_MS) return hit.ids;
  const ids = new Set<string>();
  try {
    const accounts = await prisma.metaAdAccount.findMany({
      where: { business: { connectionId } },
      select: { metaAdAccountId: true },
    });
    for (const acct of accounts) {
      const media =
        platform === "FACEBOOK"
          ? await listAdFacebookPosts(connectionId, acct.metaAdAccountId)
          : await listAdInstagramMedia(connectionId, acct.metaAdAccountId);
      for (const m of media) ids.add(m.id);
    }
    adMediaCache.set(cacheKey, { at: Date.now(), ids });
  } catch {
    // Leave the cache alone so a transient failure doesn't poison it.
    return hit?.ids ?? new Set<string>();
  }
  return ids;
}

export async function orchestrateEvent(
  event: IncomingEvent,
  opts: OrchestrateOptions = {},
): Promise<{ outcomes: ActionOutcome[] }> {
  const persist = opts.persist ?? true;
  const callAi = opts.callAi ?? true;

  const ig = await prisma.socialAccount.findUnique({
    where: {
      platform_accountId: {
        platform: event.platform,
        accountId: event.igUserId,
      },
    },
    include: {
      profile: { include: { faqs: { orderBy: { sortOrder: "asc" } } } },
      rules: { orderBy: { priority: "asc" } },
    },
  });
  if (!ig) {
    return {
      outcomes: [
        {
          action: "SKIPPED",
          ruleId: null,
          text: null,
          useAi: false,
          skipReason: "unknown_account",
          status: "SKIPPED",
        },
      ],
    };
  }

  // Idempotency row. The webhook route pre-creates it for dedupe and passes
  // eventDbId; direct callers (dogfood scripts) get it created here.
  let eventDbId = opts.eventDbId ?? null;
  if (persist && !eventDbId) {
    try {
      const row = await prisma.automationEvent.create({
        data: {
          eventId: event.eventId,
          igAccountId: ig.id,
          eventType: event.type,
          fromIgsid: event.fromIgsid,
          fromUsername: event.fromUsername,
          text: event.text,
          commentId: event.commentId,
          mediaId: event.mediaId,
          rawJson: (event.raw ?? {}) as Prisma.InputJsonValue,
        },
      });
      eventDbId = row.id;
    } catch (e) {
      // P2002 = duplicate delivery — already processed or in flight.
      if ((e as { code?: string }).code === "P2002") return { outcomes: [] };
      throw e;
    }
  }

  const rules: RuleLike[] = opts.rulesOverride ?? ig.rules;
  const profile = ig.profile;
  const corpus: ProfileCorpus = {
    businessDescription: profile?.businessDescription ?? "",
    toneRules: profile?.toneRules ?? "",
    bannedTopics: profile?.bannedTopics ?? [],
    links: (profile?.linksJson ?? {}) as Record<string, string>,
    faqs: (profile?.faqs ?? []).map((f) => ({
      question: f.question,
      answer: f.answer,
    })),
  };
  const sender =
    opts.sender ??
    (persist
      ? makeMetaSender(
          ig.connectionId,
          ig.linkedPageId,
          // `platform` is a plain String column, so narrow it rather than
          // casting: only FACEBOOK changes the reply edge, and anything
          // unexpected falls back to today's Instagram behaviour.
          ig.platform === "FACEBOOK" ? "FACEBOOK" : "INSTAGRAM",
        )
      : NOOP_SENDER);

  // Thread state — read before runOne is defined so its closure can use it
  // for AI history. Re-assigned later by the opt-out / inbound upserts.
  //
  // The thread's BotLead comes along on this same query (`include`, not a
  // second round-trip) and MUST be read here rather than in the extraction
  // block at the bottom: the lead record is the conversation's rolling
  // summary, so the reply model needs it BEFORE it writes a reply, not after.
  // Reading it late is what made the table write-only — a budget stated in
  // message 1 was safely in the DB and completely invisible to the model by
  // message 40, so the bot asked for it again.
  //
  // Read-only, so it is safe on the dry-run path for the same reason
  // getMediaCaption is (see below): purity is about not writing and not
  // sending. A brand-new thread has no lead, and `lead` is simply null — the
  // common case, handled everywhere by the optional chain / null checks.
  const threadWithLead = event.fromIgsid
    ? await prisma.botThread.findUnique({
        where: {
          igAccountId_igsid: { igAccountId: ig.id, igsid: event.fromIgsid },
        },
        include: { lead: true },
      })
    : null;
  let thread: BotThread | null = threadWithLead;
  // Reused by the extraction block at the bottom as `existingLead`, so there
  // is still exactly ONE BotLead read per event.
  const lead: BotLead | null = threadWithLead?.lead ?? null;

  // Set by runOne when the reply model asks for a human. Read later by the
  // flag decision, which runs after all actions have been attempted.
  let aiEscalated = false;

  // Post context for the AI and the {post_caption} variable. Comment events
  // carry a media id but no caption, so "how much for this?" is
  // unanswerable without it. Fetched once per event and cached in lib/meta.
  //
  // Deliberately NOT gated on `persist`: this is a read-only GET with no
  // side effects, and a dry run that skipped it would preview a different
  // reply than production would send — which defeats the point of the test
  // panel. Dry-run purity is about not writing and not SENDING, not about
  // never reading. Failures inside getMediaCaption resolve to null, so a
  // caption problem can never block a reply.
  //
  // Declared above runOne so its closure can read it for the AI prompt.
  const postCaption =
    event.type === "COMMENT" && event.mediaId
      ? await getMediaCaption(
          ig.connectionId,
          event.mediaId,
          event.platform,
          ig.linkedPageId,
        )
      : null;

  const runOne = async (a: PlannedAction): Promise<ActionOutcome> => {
    if (a.action === "SKIPPED") {
      if (persist && eventDbId) {
        await prisma.automationLog.create({
          data: {
            eventDbId,
            matchedRuleId: a.ruleId,
            action: "SKIPPED",
            status: "SKIPPED",
            skipReason: a.skipReason,
          },
        });
      }
      return { ...a, status: "SKIPPED" };
    }

    // Runtime guard: decide() plans actions off a RuleLike + IncomingEvent
    // without itself knowing whether the specific event carries the field a
    // given action needs to send (a DM rule with publicReplyEnabled used to
    // plan a PUBLIC_REPLY off a MESSAGE event, where commentId is always
    // null — the send site's non-null assertion turned that into a real
    // POST /null/replies against Meta on every inbound DM). Check for real
    // and skip rather than assert; never call the sender on a missing target.
    // AI_DM_VIA_COMMENT rides the comment channel, so it needs a commentId,
    // not an igsid — same as DM_VIA_COMMENT.
    const needsCommentId =
      a.action === "PUBLIC_REPLY" ||
      a.action === "AI_PUBLIC_REPLY" ||
      a.action === "DM_VIA_COMMENT" ||
      a.action === "AI_DM_VIA_COMMENT";
    const needsIgsid = a.action === "DM" || a.action === "AI_DM";
    if ((needsCommentId && !event.commentId) || (needsIgsid && !event.fromIgsid)) {
      if (persist && eventDbId) {
        await prisma.automationLog.create({
          data: {
            eventDbId,
            matchedRuleId: a.ruleId,
            action: "SKIPPED",
            status: "SKIPPED",
            skipReason: "missing_target",
          },
        });
      }
      return { ...a, action: "SKIPPED", skipReason: "missing_target", status: "SKIPPED" };
    }

    let text = a.text;
    if (a.useAi) {
      if (!callAi) {
        text = "[AI would generate here]";
      } else {
        try {
          const threadMsgs = thread
            ? await readRecentMessages(thread.id, AI_HISTORY_LIMIT)
            : [];
          const ai = await generateAiReply({
            profile: corpus,
            languageMode: profile?.languageMode ?? "mirror",
            history: threadMsgs,
            userText: event.text,
            postCaption,
            // The rule that produced this action steers the wording. a.ruleId
            // is null for the profile-level fallback (no rule matched), which
            // correctly falls back to profile-only instructions.
            channel:
              a.action === "AI_PUBLIC_REPLY" ? "PUBLIC_REPLY" : "DM",
            // Does this same comment also get a DM? If so the public reply
            // must point at the DM instead of answering, or the two come out
            // near-identical. `planned` is the full action list for this
            // event, so this is known before either AI call is made.
            companionDm:
              a.action === "AI_PUBLIC_REPLY" &&
              planned.some(
                (other) =>
                  other.action === "DM" ||
                  other.action === "AI_DM" ||
                  other.action === "DM_VIA_COMMENT" ||
                  other.action === "AI_DM_VIA_COMMENT",
              ),
            ruleInstructions: a.ruleId
              ? rules.find((r) => r.id === a.ruleId)?.aiInstructions
              : undefined,
            platform: event.platform,
            // Durable facts that have aged out of the 30-message window.
            // buildSystemPrompt reads an allowlist of fields off this and
            // never touches email/phone — see LeadFacts in ai-guards.ts.
            lead,
          });
          if (ai.escalate) aiEscalated = true;
          if (!ai.safe || ai.confidence < 0.6 || ai.escalate) {
            if (a.action === "AI_DM" || a.action === "AI_DM_VIA_COMMENT") {
              text = HUMAN_FALLBACK_TEXT;
            } else {
              // Public contexts never post an unvetted fallback.
              const skipped: ActionOutcome = {
                ...a,
                action: "SKIPPED",
                skipReason: "ai_low_confidence",
                status: "SKIPPED",
              };
              if (persist && eventDbId) {
                await prisma.automationLog.create({
                  data: {
                    eventDbId,
                    matchedRuleId: a.ruleId,
                    action: "SKIPPED",
                    status: "SKIPPED",
                    skipReason: "ai_low_confidence",
                  },
                });
              }
              return skipped;
            }
          } else {
            text = ai.reply;
          }
        } catch {
          if (a.action === "AI_DM" || a.action === "AI_DM_VIA_COMMENT") {
            text = HUMAN_FALLBACK_TEXT;
          } else {
            if (persist && eventDbId) {
              await prisma.automationLog.create({
                data: {
                  eventDbId,
                  matchedRuleId: a.ruleId,
                  action: "SKIPPED",
                  status: "SKIPPED",
                  skipReason: "ai_unavailable",
                },
              });
            }
            return { ...a, action: "SKIPPED", skipReason: "ai_unavailable", status: "SKIPPED" };
          }
        }
      }
    }

    // Backstop: a template can render to "" (e.g. "{message_text}" on a
    // comment event) and generateAiReply can itself return an empty reply
    // that still passes isReplySafe trivially. Never let a blank body reach
    // the sender — a blank DM or blank public comment in front of a real
    // customer is a visible, embarrassing failure. decide.ts already guards
    // the template-render paths (see plannedFromRender); this is the
    // catch-all for the AI path and any other way `text` could end up empty.
    if (!text || !text.trim()) {
      if (persist && eventDbId) {
        await prisma.automationLog.create({
          data: {
            eventDbId,
            matchedRuleId: a.ruleId,
            action: "SKIPPED",
            status: "SKIPPED",
            skipReason: "empty_render",
          },
        });
      }
      return { ...a, action: "SKIPPED", skipReason: "empty_render", status: "SKIPPED" };
    }

    // Audit-first: PENDING row before the Meta call.
    const logRow =
      persist && eventDbId
        ? await prisma.automationLog.create({
            data: {
              eventDbId,
              matchedRuleId: a.ruleId,
              action: a.action,
              renderedText: text,
              status: "PENDING",
            },
          })
        : null;
    try {
      let metaMid: string | null = null;
      if (a.action === "PUBLIC_REPLY" || a.action === "AI_PUBLIC_REPLY") {
        // Unreachable given the missing_target guard above — kept as a real
        // check (not an assertion) so a future refactor that removes that
        // guard fails safe here too, instead of hitting Meta with "/null/...".
        if (!event.commentId) throw new Error("missing_target: no commentId");
        metaMid = await sender.sendPublicReply(event.commentId, text!);
      } else if (
        a.action === "DM_VIA_COMMENT" ||
        a.action === "AI_DM_VIA_COMMENT"
      ) {
        if (!event.commentId) throw new Error("missing_target: no commentId");
        metaMid = await sender.sendCommentDm(event.commentId, text!);
      } else {
        if (!event.fromIgsid) throw new Error("missing_target: no fromIgsid");
        metaMid = await sender.sendThreadDm(event.fromIgsid, text!);
      }
      if (logRow) {
        await prisma.automationLog.update({
          where: { id: logRow.id },
          data: { status: "SENT", sentAt: new Date() },
        });
      }

      // A DM send that succeeds but returns no message_id is a real problem
      // with a delayed, confusing symptom: the BotMessage row below gets
      // metaMid=null, so when Meta echoes this very message back, echo.ts
      // finds no matching row, reads its own send as an outside human reply
      // and flips the thread to HUMAN — permanently muting the bot there.
      // Warn loudly so it's diagnosable at the moment it happens.
      //
      // Deliberately NOT thrown and NOT stamped FAILED: the message WAS
      // delivered. Reporting FAILED would misstate reality in the audit log
      // and invite an operator (or a retry) to send the same DM twice, which
      // is worse for the customer than a mis-attributed echo.
      // PUBLIC_REPLY / AI_PUBLIC_REPLY are excluded because makeMetaSender
      // returns null for them on purpose (a comment id is not a message mid).
      if (
        persist &&
        !metaMid &&
        a.action !== "PUBLIC_REPLY" &&
        a.action !== "AI_PUBLIC_REPLY"
      ) {
        console.warn(
          `[automation] send succeeded but Meta returned no message_id (action=${a.action}, thread=${thread?.id ?? "none"}); echo reconciliation will misfire and may flip this thread to HUMAN`,
        );
      }

      // Record THIS bot reply NOW, per-send — deliberately NOT batched into
      // one createMany after the action loop. Do not "tidy" this back.
      //
      // The race: Meta echoes every outbound message straight back to
      // /api/webhooks/meta, and echo.ts's recordEcho decides "this echo is
      // our own send" purely by finding a BotMessage whose `metaMid`
      // matches. A trailing batch leaves the row unwritten for the whole
      // remainder of orchestrateEvent — a window that includes the next
      // action's AI generation (seconds) on the common multi-action plan
      // (public reply + DM), while a Meta webhook round-trip is often well
      // under a second. An echo landing inside that window finds no row, so
      // recordEcho treats the bot's own message as a human reply, flips
      // `ownership` to HUMAN, and inserts the mid as a HUMAN row — after
      // which appendMessages' `skipDuplicates` silently swallows the bot's
      // real row and the bot is permanently mute on that thread. Writing
      // here shrinks the window to the gap between the Send API responding
      // and this single insert committing.
      //
      // Ordering is preserved: readRecentMessages sorts by createdAt then
      // id, these inserts are sequential (the action loop never fans out),
      // and cuid()s are monotonic — so per-send rows read back in send
      // order exactly as the batch did.
      //
      // Only reached on a SUCCESSFUL send (the catch below returns without
      // touching this), so a FAILED send still produces no message row.
      // `persist` gates it, so a dry run writes nothing.
      const t = thread;
      if (persist && t && text) {
        try {
          await appendMessages(t.id, [
            {
              role: "BOT",
              text,
              channel:
                a.action === "PUBLIC_REPLY" || a.action === "AI_PUBLIC_REPLY"
                  ? "COMMENT"
                  : "DM",
              metaMid,
            },
          ]);
        } catch (e) {
          // Bookkeeping must never restamp a delivered message as FAILED,
          // which is exactly what letting this hit the outer catch would do.
          console.warn("[automation] failed to record bot message", e);
        }
      }

      return { ...a, text, status: persist ? "SENT" : "PLANNED", metaMid };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (logRow) {
        await prisma.automationLog.update({
          where: { id: logRow.id },
          data: { status: "FAILED", metaError: msg },
        });
      }
      return { ...a, text, status: "FAILED", metaError: msg };
    }
  };

  // Bot disabled → one visible SKIPPED row, no further work.
  // The bot toggle gates LIVE traffic only. A dry run must still evaluate
  // rules with the bot off — that is the whole point of testing a rule
  // before arming it, and persist=false already guarantees no send and no
  // write (NOOP_SENDER + every write gated on `persist`). Gating the dry
  // run here made the test panel answer "bot_disabled" to every input,
  // which told the user nothing about their rule.
  if (!ig.botEnabled && persist) {
    const out = await runOne({
      action: "SKIPPED",
      ruleId: null,
      text: null,
      useAi: false,
      skipReason: "bot_disabled",
    });
    return { outcomes: [out] };
  }

  // Opt-out: any inbound DM that reads as "stop" → opt the thread out,
  // send one confirmation (allowed: it's within the 24h window), done.
  if (event.type === "MESSAGE" && event.fromIgsid && isOptOutMessage(event.text)) {
    // Capture BEFORE the upsert: this is the only way to tell "first stop"
    // from "the 10th stop from someone already opted out". This branch runs
    // ahead of decide(), so without this check it bypasses both the daily
    // cap and the already-opted-out state and would send a confirmation DM
    // for every single "stop" message a user sends.
    const alreadyOptedOut = thread?.optedOut ?? false;
    if (persist) {
      thread = await prisma.botThread.upsert({
        where: {
          igAccountId_igsid: { igAccountId: ig.id, igsid: event.fromIgsid },
        },
        create: {
          igAccountId: ig.id,
          igsid: event.fromIgsid,
          lastInboundAt: new Date(),
          optedOut: true,
        },
        update: { optedOut: true, lastInboundAt: new Date() },
      });
      // Record the "stop" message itself. The old blob wrote this on the
      // create branch only, so a repeat opt-out from an existing thread was
      // never recorded at all.
      await appendMessages(thread.id, [
        {
          role: "USER",
          text: event.text,
          channel: "DM",
          // Same dedupe key the normal inbound path sets below. Without it a
          // redelivered "stop" webhook appends a second identical USER row —
          // appendMessages dedupes on metaMid, and a null can't match.
          metaMid: event.eventId ?? null,
        },
      ]);
    }
    if (alreadyOptedOut) {
      const out = await runOne({
        action: "SKIPPED",
        ruleId: null,
        text: null,
        useAi: false,
        skipReason: "already_opted_out",
      });
      return { outcomes: [out] };
    }
    const outcomes: ActionOutcome[] = [];
    outcomes.push(
      await runOne({
        action: "DM",
        ruleId: null,
        text:
          profile?.optOutConfirmation ??
          "You've been unsubscribed and won't receive more messages.",
        useAi: false,
        skipReason: null,
      }),
    );
    outcomes.push(
      await runOne({
        action: "SKIPPED",
        ruleId: null,
        text: null,
        useAi: false,
        skipReason: "opted_out",
      }),
    );
    return { outcomes };
  }

  // Update thread with this inbound event (persist mode only). Comments
  // never set lastInboundAt — only DMs open the 24h window.
  if (persist && event.fromIgsid) {
    thread = await prisma.botThread.upsert({
      where: {
        igAccountId_igsid: { igAccountId: ig.id, igsid: event.fromIgsid },
      },
      create: {
        igAccountId: ig.id,
        igsid: event.fromIgsid,
        lastInboundAt: event.type === "MESSAGE" ? new Date() : null,
        username: event.fromUsername ?? null,
      },
      update: {
        ...(event.type === "MESSAGE" ? { lastInboundAt: new Date() } : {}),
        // Never overwrite a known username with null — comment webhooks
        // carry one, DM webhooks don't (see src/lib/meta/webhooks.ts), so a
        // DM arriving after a comment must not erase what the comment
        // taught us.
        ...(event.fromUsername ? { username: event.fromUsername } : {}),
      },
    });
    await appendMessages(thread.id, [
      {
        role: "USER",
        text: event.text,
        channel: event.type === "MESSAGE" ? "DM" : "COMMENT",
        // Dedupe key: a redelivered webhook must not append the message twice.
        metaMid: event.type === "MESSAGE" ? (event.eventId ?? null) : null,
      },
    ]);
  }

  // Guardrail inputs for decide().
  // Which IG media are currently ads? Needed for mediaScope ADS/ORGANIC —
  // ad creatives are usually dark posts, invisible to the organic media
  // list, so this is the only way a rule can tell them apart. Only fetched
  // when some rule actually asks for it, so the common case (ALL/SPECIFIC)
  // costs nothing. A failure resolves to an empty set: ADS rules then match
  // nothing rather than misfiring on organic posts.
  const needsAdMedia =
    event.type === "COMMENT" &&
    rules.some((r) => r.mediaScope === "ADS" || r.mediaScope === "ORGANIC");
  const adMediaIds = needsAdMedia
    ? await getAdMediaIds(ig.connectionId, ig.platform)
    : new Set<string>();

  const { rule: matchedRule, vetoed: vetoedByNegativeKeyword } =
    matchRuleWithReason(event, rules, adMediaIds);
  const since = new Date(Date.now() - DAY_MS);
  const dmCountLast24h = event.fromIgsid
    ? await prisma.automationLog.count({
        where: {
          action: { in: DM_ACTIONS },
          status: "SENT",
          sentAt: { gt: since },
          event: { igAccountId: ig.id, fromIgsid: event.fromIgsid },
        },
      })
    : 0;
  const alreadySentForRuleUser =
    matchedRule && event.fromIgsid
      ? (await prisma.automationLog.count({
          where: {
            matchedRuleId: matchedRule.id,
            action: { in: DM_ACTIONS },
            status: "SENT",
            event: { igAccountId: ig.id, fromIgsid: event.fromIgsid },
          },
        })) > 0
      : false;
  const publicReplyCountLast24h = event.fromIgsid
    ? await prisma.automationLog.count({
        where: {
          action: { in: PUBLIC_REPLY_ACTIONS },
          status: "SENT",
          sentAt: { gt: since },
          event: { igAccountId: ig.id, fromIgsid: event.fromIgsid },
        },
      })
    : 0;
  const alreadySentPublicForRuleUser =
    matchedRule && event.fromIgsid
      ? (await prisma.automationLog.count({
          where: {
            matchedRuleId: matchedRule.id,
            action: { in: PUBLIC_REPLY_ACTIONS },
            status: "SENT",
            event: { igAccountId: ig.id, fromIgsid: event.fromIgsid },
          },
        })) > 0
      : false;

  // Layer 3 runs here, not in decide(), because decide() is pure and this
  // is a network call. Only when the matched rule asks for it — and the
  // whole thing is best-effort: any failure yields null, which decide()
  // treats as "no opinion" and replies anyway.
  //
  // Gated on `!(matchedRule.skipNoIntent && !hasIntent(event.text))` as a
  // cost decision, not a correctness one: the free no-intent filter (Layer
  // 2) lives inside decide() and would suppress the same message anyway, so
  // paying for a gpt-4o-mini call before decide() gets to run is pure waste
  // — with both toggles on, "🔥🔥🔥" used to burn an AI call and then get
  // skipped regardless. Free checks must decide before the paid one runs.
  let intentVerdict: IntentVerdict | null = null;
  if (
    matchedRule?.aiIntentGuard &&
    callAi &&
    !(matchedRule.skipNoIntent && !hasIntent(event.text)) &&
    !thread?.optedOut &&
    thread?.ownership !== "HUMAN"
  ) {
    try {
      intentVerdict = await classifyIntent({
        text: event.text,
        postCaption,
      });
    } catch (e) {
      // Fail OPEN (reply anyway) is correct — but invisibly is not. If the
      // OpenAI key is revoked, this guard silently stops working and
      // nothing in the activity feed explains why complaints are being
      // answered again. Not an AutomationLog SKIPPED row: the message is
      // NOT being skipped here, decide() still proceeds to reply.
      intentVerdict = null;
      console.warn("[automation] intent guard unavailable, replying anyway", e);
    }
  }

  const planned = decide({
    event,
    matchedRule,
    vetoedByNegativeKeyword,
    intentVerdict,
    aiFallbackEnabled: profile?.aiFallbackEnabled ?? false,
    optedOut: thread?.optedOut ?? false,
    humanOwned: thread?.ownership === "HUMAN",
    lastInboundAt:
      event.type === "MESSAGE"
        ? new Date() // replying to an inbound DM is always in-window
        : (thread?.lastInboundAt ?? null),
    dmCountLast24h,
    alreadySentForRuleUser,
    publicReplyCountLast24h,
    alreadySentPublicForRuleUser,
    links: corpus.links,
    postCaption,
    now: new Date(),
  });

  const outcomes: ActionOutcome[] = [];
  for (const a of planned) {
    outcomes.push(await runOne(a)); // sequential — never Promise.all
  }

  // NOTE: bot replies are NOT recorded here. Each one is written inside
  // runOne immediately after its own successful send, with the `metaMid`
  // Meta returned — see the long comment there for the echo race that
  // batching them at this point reintroduces. This block used to hold that
  // trailing createMany; it is gone on purpose, so there is exactly one
  // write path and no double-write.

  // Lead extraction + flagging. Runs after replies so the flag decision can
  // see whether the reply model escalated.
  //
  // Gated on `hasIntent` for the same cost reason the intent guard is: paying
  // for an extraction call on "🔥🔥🔥" is pure waste. Gated on `persist` so a
  // dry run neither writes nor bills.
  //
  // `!thread.optedOut` matches the intent guard's posture above. Someone who
  // said "stop" gets no reply (decide() suppresses it), so extracting from
  // them buys nothing — it only spends a gpt-4o-mini call and builds a lead
  // profile on a person who explicitly asked to be left alone.
  //
  // `thread.ownership !== "HUMAN"` for the same reason: a human is handling
  // the conversation, so paying for extraction on every message they
  // exchange is waste — and the operator can see the thread themselves.
  if (
    persist &&
    thread &&
    !thread.optedOut &&
    thread.ownership !== "HUMAN" &&
    callAi &&
    event.fromIgsid &&
    hasIntent(event.text)
  ) {
    try {
      // Read once, at the top of the function, and reused here — the reply
      // model needs it before it replies, and a second query would be a
      // second round-trip for a row nothing has written since.
      const existingLead = lead;
      const history = await readRecentMessages(thread.id, AI_HISTORY_LIMIT);
      const extracted = await extractLead({ history, userText: event.text });

      const before: LeadFields | null = existingLead
        ? {
            name: existingLead.name,
            email: existingLead.email,
            phone: existingLead.phone,
            company: existingLead.company,
            requirement: existingLead.requirement,
            budget: existingLead.budget,
            timeline: existingLead.timeline,
          }
        : null;

      const merged = mergeLead(before, extracted);
      const priorStage = (existingLead?.stage ?? null) as LeadStage | null;
      const nextStage = deriveStage(merged, priorStage);

      // Two concurrent after() handlers can race on the same thread (e.g. a
      // comment and a DM arriving together, or two rapid inbound DMs): both
      // read `existingLead` before either has written, so a plain
      // `update: { ...merged }` lets whichever write lands second stomp
      // fields the first one just persisted with nulls its own extraction
      // simply didn't see (the very loss `mergeLead` exists to prevent).
      // Only send the NON-NULL entries of `merged` on update, so a field
      // not mentioned in this turn is left untouched rather than erased.
      const FIELD_KEYS = Object.keys(EMPTY_LEAD) as Array<keyof LeadFields>;
      const nonNullFields: Partial<LeadFields> = {};
      for (const key of FIELD_KEYS) {
        if (merged[key] !== null) nonNullFields[key] = merged[key];
      }

      // Stage is guarded the same way, but a simple "only if non-null"
      // filter doesn't apply to a single enum column — instead the WHERE
      // clause below is checked against the row's LIVE stage at the moment
      // this UPDATE executes (atomic per statement), not the possibly-stale
      // `priorStage` read above. That stops a handler that read stage=NEW
      // from dragging a concurrently-advanced QUALIFIED back down to
      // ENGAGED. UNQUALIFIED is never produced by `deriveStage` here, but is
      // included in the rank so an operator-set UNQUALIFIED (Phase 3) is
      // never silently downgraded by this path either.
      const STAGE_RANK: Record<LeadStage, number> = {
        NEW: 0,
        ENGAGED: 1,
        QUALIFIED: 2,
        UNQUALIFIED: 3,
      };
      const safeCurrentStages = (Object.keys(STAGE_RANK) as LeadStage[]).filter(
        (s) => STAGE_RANK[s] <= STAGE_RANK[nextStage],
      );

      const updated = await prisma.botLead.updateMany({
        where: { threadId: thread.id, stage: { in: safeCurrentStages } },
        data: { ...nonNullFields, stage: nextStage },
      });

      if (updated.count === 0) {
        // Either no row exists yet for this thread, or one exists but is
        // already at a stage this write must not downgrade (the WHERE above
        // excluded it). Either way, the facts extracted THIS turn must still
        // land — the stage guard must never become a reason to drop a
        // newly-learned field.
        try {
          await prisma.botLead.create({
            data: { threadId: thread.id, ...merged, stage: nextStage },
          });
        } catch (e) {
          // P2002 = a concurrent handler created the row between our read
          // and this create — i.e. the "already exists at a higher/guarded
          // stage" case. Fall back to a fields-only update; stage is
          // deliberately left untouched here since we no longer know what
          // the other handler wrote and must not risk downgrading it.
          if ((e as { code?: string }).code !== "P2002") throw e;
          await prisma.botLead.updateMany({
            where: { threadId: thread.id },
            data: nonNullFields,
          });
        }
      }

      // Only the TRANSITION into QUALIFIED flags — not every later message
      // while the lead stays qualified, which would re-flag forever.
      const becameQualified =
        nextStage === "QUALIFIED" && priorStage !== "QUALIFIED";

      const reason = pickFlagReason({
        aiEscalated,
        intentCategory: intentVerdict?.category ?? null,
        becameQualified,
        currentReason: (thread.flagReason ?? null) as
          | "ai_stuck"
          | "complaint"
          | "qualified"
          | null,
      });
      if (reason) {
        await prisma.botThread.update({
          where: { id: thread.id },
          data: { flagReason: reason, flaggedAt: new Date(), resolvedAt: null },
        });
      }
    } catch (e) {
      // Fail OPEN, loudly. The reply has already been sent by this point, so
      // a failure here costs qualification data, never a response. Silence
      // would make a revoked OpenAI key look like "no leads are qualifying".
      console.warn("[automation] lead extraction failed", e);
    }
  }

  return { outcomes };
}
