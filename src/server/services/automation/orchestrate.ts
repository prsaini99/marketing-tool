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

import { Prisma } from "@prisma/client";
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
import type {
  IncomingEvent,
  PlannedAction,
  RuleLike,
} from "./types";

export interface Sender {
  sendPublicReply(commentId: string, text: string): Promise<void>;
  sendCommentDm(commentId: string, text: string): Promise<void>;
  sendThreadDm(igsid: string, text: string): Promise<void>;
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
    sendPublicReply: (commentId, text) =>
      replyToComment(connectionId, requirePageId(), commentId, text).then(
        () => undefined,
      ),
    sendCommentDm: (commentId, text) =>
      sendDmToCommenter(connectionId, requirePageId(), commentId, text).then(
        () => undefined,
      ),
    sendThreadDm: (igsid, text) =>
      sendDm(connectionId, requirePageId(), igsid, text).then(() => undefined),
  };
}

/**
 * Dry-run guard: when persist=false and the caller injected no Sender, we
 * must NEVER fall through to the real Meta sender. A dry run that sends a
 * live DM is the worst possible failure mode of this module, so the safe
 * sender is the structural default rather than a caller convention.
 */
const NOOP_SENDER: Sender = {
  sendPublicReply: async () => {},
  sendCommentDm: async () => {},
  sendThreadDm: async () => {},
};

function readThreadMessages(
  json: Prisma.JsonValue,
): Array<{ role: string; text: string }> {
  if (!Array.isArray(json)) return [];
  return json
    .filter(
      (m): m is { role: string; text: string } =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as { role?: unknown }).role === "string" &&
        typeof (m as { text?: unknown }).text === "string",
    )
    .map((m) => ({ role: m.role, text: m.text }));
}

function appendThreadMessages(
  json: Prisma.JsonValue,
  additions: Array<{ role: string; text: string }>,
): Prisma.InputJsonValue {
  const next = [
    ...readThreadMessages(json),
    ...additions.map((a) => ({ ...a, at: new Date().toISOString() })),
  ];
  return next.slice(-10) as unknown as Prisma.InputJsonValue;
}


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
      ? makeMetaSender(ig.connectionId, ig.linkedPageId)
      : NOOP_SENDER);

  // Thread state — read before runOne is defined so its closure can use it
  // for AI history. Re-assigned later by the opt-out / inbound upserts.
  let thread = event.fromIgsid
    ? await prisma.botThread.findUnique({
        where: {
          igAccountId_igsid: { igAccountId: ig.id, igsid: event.fromIgsid },
        },
      })
    : null;

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
            ? readThreadMessages(thread.recentMessagesJson)
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
          });
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
      if (a.action === "PUBLIC_REPLY" || a.action === "AI_PUBLIC_REPLY") {
        // Unreachable given the missing_target guard above — kept as a real
        // check (not an assertion) so a future refactor that removes that
        // guard fails safe here too, instead of hitting Meta with "/null/...".
        if (!event.commentId) throw new Error("missing_target: no commentId");
        await sender.sendPublicReply(event.commentId, text!);
      } else if (
        a.action === "DM_VIA_COMMENT" ||
        a.action === "AI_DM_VIA_COMMENT"
      ) {
        if (!event.commentId) throw new Error("missing_target: no commentId");
        await sender.sendCommentDm(event.commentId, text!);
      } else {
        if (!event.fromIgsid) throw new Error("missing_target: no fromIgsid");
        await sender.sendThreadDm(event.fromIgsid, text!);
      }
      if (logRow) {
        await prisma.automationLog.update({
          where: { id: logRow.id },
          data: { status: "SENT", sentAt: new Date() },
        });
      }
      return { ...a, text, status: persist ? "SENT" : "PLANNED" };
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
          recentMessagesJson: [
            { role: "user", text: event.text, at: new Date().toISOString() },
          ],
        },
        update: { optedOut: true, lastInboundAt: new Date() },
      });
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
        recentMessagesJson: [
          { role: "user", text: event.text, at: new Date().toISOString() },
        ],
      },
      update: {
        ...(event.type === "MESSAGE" ? { lastInboundAt: new Date() } : {}),
        recentMessagesJson: appendThreadMessages(thread?.recentMessagesJson ?? [], [
          { role: "user", text: event.text },
        ]),
      },
    });
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
    !thread?.optedOut
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

  // Append bot replies to the thread for future AI context.
  if (persist && thread) {
    const botTexts = outcomes
      .filter((o) => (o.status === "SENT" || o.status === "PLANNED") && o.text)
      .map((o) => ({ role: "assistant", text: o.text! }));
    if (botTexts.length > 0) {
      await prisma.botThread.update({
        where: { id: thread.id },
        data: {
          recentMessagesJson: appendThreadMessages(
            thread.recentMessagesJson,
            botTexts,
          ),
        },
      });
    }
  }

  return { outcomes };
}
