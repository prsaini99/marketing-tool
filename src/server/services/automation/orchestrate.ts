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
  replyToComment,
  sendDm,
  sendDmToCommenter,
} from "@/lib/meta/instagram";
import { decide, HUMAN_FALLBACK_TEXT } from "./decide";
import { matchRule } from "./match";
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
  sender?: Sender; // default: real Meta sender
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
const DM_ACTIONS = ["DM", "AI_DM", "DM_VIA_COMMENT"];

function makeMetaSender(connectionId: string, igUserId: string): Sender {
  return {
    sendPublicReply: (commentId, text) =>
      replyToComment(connectionId, commentId, text).then(() => undefined),
    sendCommentDm: (commentId, text) =>
      sendDmToCommenter(connectionId, igUserId, commentId, text).then(
        () => undefined,
      ),
    sendThreadDm: (igsid, text) =>
      sendDm(connectionId, igUserId, igsid, text).then(() => undefined),
  };
}

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

export async function orchestrateEvent(
  event: IncomingEvent,
  opts: OrchestrateOptions = {},
): Promise<{ outcomes: ActionOutcome[] }> {
  const persist = opts.persist ?? true;
  const callAi = opts.callAi ?? true;

  const ig = await prisma.instagramAccount.findUnique({
    where: { igUserId: event.igUserId },
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
    opts.sender ?? makeMetaSender(ig.connectionId, ig.igUserId);

  // Thread state — read before runOne is defined so its closure can use it
  // for AI history. Re-assigned later by the opt-out / inbound upserts.
  let thread = event.fromIgsid
    ? await prisma.botThread.findUnique({
        where: {
          igAccountId_igsid: { igAccountId: ig.id, igsid: event.fromIgsid },
        },
      })
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
          });
          if (!ai.safe || ai.confidence < 0.6 || ai.escalate) {
            if (a.action === "AI_DM") {
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
          if (a.action === "AI_DM") {
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
        await sender.sendPublicReply(event.commentId!, text!);
      } else if (a.action === "DM_VIA_COMMENT") {
        await sender.sendCommentDm(event.commentId!, text!);
      } else {
        await sender.sendThreadDm(event.fromIgsid!, text!);
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
  if (!ig.botEnabled) {
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
  const matchedRule = matchRule(event, rules);
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

  const planned = decide({
    event,
    matchedRule,
    aiFallbackEnabled: profile?.aiFallbackEnabled ?? false,
    optedOut: thread?.optedOut ?? false,
    lastInboundAt:
      event.type === "MESSAGE"
        ? new Date() // replying to an inbound DM is always in-window
        : (thread?.lastInboundAt ?? null),
    dmCountLast24h,
    alreadySentForRuleUser,
    links: corpus.links,
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
